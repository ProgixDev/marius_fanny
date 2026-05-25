import { Router } from "express";
import userRoutes from "./user.routes.js";
import profileRoutes from "./profile.routes.js";
import authRoutes from "./auth.routes.js";
import orderRoutes from "./order.routes.js";
import proOrderRoutes from "./proOrder.routes.js";
import paymentRoutes from "./payment.routes.js";
import productRoutes from "./product.routes.js";
import uploadRoutes from "./upload.routes.js";
import categoryRoutes from "./category.routes.js";
import inventoryRoutes from "./inventory.routes.js";
import dailyInventoryRoutes from "./dailyInventory.routes.js";
import partnerRoutes from "./partner.routes.js";
import promoRoutes from "./promo.routes.js";
import paymentReminderRoutes from "./paymentReminder.routes.js";
import settingsRoutes from "./settings.routes.js";
import contactRoutes from "./contact.routes.js";
import quoteRoutes from "./quote.routes.js";

const router = Router();

/**
 * Health check endpoint
 */
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "API is healthy",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Email diagnostic endpoint — confirms whether the SMTP/Resend config is
 * actually loaded in this Vercel deployment, and optionally fires a real
 * test email so the admin can verify delivery (and spam-folder status)
 * without placing a fake order.
 *
 *   GET  /api/health/email             → reports env-var presence only
 *   GET  /api/health/email?to=foo@bar  → also sends a test email
 */
router.get("/health/email", async (req, res) => {
  const config = {
    EMAIL_HOST: Boolean(process.env.EMAIL_HOST),
    EMAIL_PORT: process.env.EMAIL_PORT || "(unset)",
    EMAIL_USER: process.env.EMAIL_USER ? maskEmail(process.env.EMAIL_USER) : null,
    EMAIL_PASSWORD: Boolean(process.env.EMAIL_PASSWORD),
    RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || null,
  };
  const provider = config.RESEND_API_KEY && config.RESEND_FROM_EMAIL ? "resend" : "nodemailer";

  const to = String(req.query.to || "").trim();
  if (!to) {
    return res.json({
      success: true,
      provider,
      config,
      hint: "Append ?to=your@email.com to send a real test message.",
    });
  }

  try {
    const { default: nodemailer } = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || "587"),
      secure: process.env.EMAIL_PORT === "465",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
    await transporter.verify();
    const info = await transporter.sendMail({
      from: `"Marius & Fanny" <${process.env.EMAIL_USER}>`,
      to,
      subject: "✅ Test email Marius & Fanny",
      html: `<p>Si tu lis ceci, la configuration email du backend est OK.</p>
             <p>Envoyé à ${new Date().toISOString()} via ${provider}.</p>`,
    });
    return res.json({
      success: true,
      provider,
      config,
      sent: { to, messageId: info.messageId, response: info.response },
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      provider,
      config,
      error: error?.message || String(error),
      code: error?.code,
      command: error?.command,
      responseCode: error?.responseCode,
    });
  }
});

function maskEmail(s: string): string {
  const [local, domain] = s.split("@");
  if (!domain) return s.slice(0, 3) + "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

/**
 * Diagnostic — inspect what better-auth has stored for a given email so we
 * can see exactly which fields/IDs the `account` collection uses. Used to
 * debug the password-reset flow.
 *
 *   GET /api/health/auth-account?email=foo@bar.com
 */
router.get("/health/auth-account", async (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({
      success: false,
      error: "Provide ?email=foo@bar.com",
    });
  }
  try {
    const mongoose = await import("mongoose");
    const db = mongoose.default.connection.db;
    if (!db) {
      return res.status(500).json({ success: false, error: "DB not connected" });
    }
    const userDoc = await db
      .collection("user")
      .findOne({ email }, { projection: { email: 1, name: 1, role: 1, emailVerified: 1 } });
    if (!userDoc) {
      return res.json({ success: true, found: false, hint: "No user with this email" });
    }
    // Look up accounts by both possible userId conventions.
    const accountsAsStr = await db
      .collection("account")
      .find({ userId: userDoc._id.toString() })
      .project({ providerId: 1, accountId: 1, userId: 1, password: 1 })
      .toArray();
    const accountsAsObj = await db
      .collection("account")
      .find({ userId: userDoc._id })
      .project({ providerId: 1, accountId: 1, userId: 1, password: 1 })
      .toArray();
    const mask = (s: any) =>
      typeof s === "string" && s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)} (${s.length} chars)` : s;
    return res.json({
      success: true,
      found: true,
      user: {
        _id: userDoc._id.toString(),
        email: maskEmail(userDoc.email),
        name: userDoc.name,
        role: userDoc.role,
        emailVerified: userDoc.emailVerified,
      },
      accountsMatchedByStringUserId: accountsAsStr.map((a: any) => ({
        ...a,
        userId: mask(typeof a.userId === "string" ? a.userId : a.userId?.toString()),
        accountId: mask(a.accountId),
        password: a.password ? mask(a.password) : "(none)",
      })),
      accountsMatchedByObjectIdUserId: accountsAsObj.map((a: any) => ({
        ...a,
        userId: mask(typeof a.userId === "string" ? a.userId : a.userId?.toString()),
        accountId: mask(a.accountId),
        password: a.password ? mask(a.password) : "(none)",
      })),
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

/**
 * Diagnostic — tests whether a given email/password combination would
 * actually verify against the bcrypt hash stored in better-auth's `account`
 * collection. Use this to confirm the reset-password flow actually updated
 * the right field.
 *
 *   GET /api/health/auth-test?email=foo@bar.com&password=newpass
 *
 * Returns { matches: true } if the password is valid for this account.
 */
router.get("/health/auth-test", async (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  const password = String(req.query.password || "");
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: "Provide ?email=foo@bar.com&password=...",
    });
  }
  try {
    const [{ default: mongoose }, bcrypt] = await Promise.all([
      import("mongoose"),
      import("bcrypt"),
    ]);
    const db = mongoose.connection.db;
    if (!db) return res.status(500).json({ success: false, error: "DB not connected" });

    const userDoc = await db.collection("user").findOne({ email });
    if (!userDoc) return res.json({ success: true, found: false, hint: "No user" });

    const userIdStr = userDoc._id.toString();
    const accounts = await db
      .collection("account")
      .find({
        providerId: "credential",
        $or: [{ userId: userIdStr }, { userId: userDoc._id }, { accountId: userIdStr }],
      })
      .toArray();

    if (accounts.length === 0) {
      return res.json({
        success: true,
        found: true,
        accountFound: false,
        hint: "User exists but no credential account",
      });
    }

    const results = await Promise.all(
      accounts.map(async (a: any) => {
        let matches = false;
        let verifyError: string | null = null;
        try {
          matches = await bcrypt.default.compare(password, a.password);
        } catch (e: any) {
          verifyError = e?.message || String(e);
        }
        return {
          accountId: a.accountId,
          providerId: a.providerId,
          hashPrefix: typeof a.password === "string" ? a.password.slice(0, 7) : null,
          hashLength: typeof a.password === "string" ? a.password.length : 0,
          matches,
          verifyError,
        };
      }),
    );
    return res.json({
      success: true,
      found: true,
      accountFound: true,
      results,
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get("/public/google-review", (req, res) => {
  const placeId = String(process.env.GOOGLE_REVIEW_PLACE_ID_LAVAL || "").trim();
  const url =
    (placeId
      ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
      : "https://www.google.com/maps/search/?api=1&query=Marius%20%26%20Fanny%20Laval");
  res.redirect(302, url);
});

/**
 * Mount route modules
 */
router.use("/users", userRoutes);
router.use("/profile", profileRoutes);
router.use("/auth-password", authRoutes);
router.use("/orders", orderRoutes);
router.use("/pro-orders", proOrderRoutes);
router.use("/payments", paymentRoutes);
router.use("/products", productRoutes);
router.use("/categories", categoryRoutes);
router.use("/upload", uploadRoutes);
router.use("/inventory", inventoryRoutes);
router.use("/daily-inventory", dailyInventoryRoutes);
router.use("/partner-request", partnerRoutes);
router.use("/promos", promoRoutes);
router.use("/payment-reminders", paymentReminderRoutes);
router.use("/settings", settingsRoutes);
router.use("/contact", contactRoutes);
router.use("/quotes", quoteRoutes);

export default router;
