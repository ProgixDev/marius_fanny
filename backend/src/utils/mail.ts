import * as nodemailer from "nodemailer";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

// Resend client — only used when RESEND_FROM_EMAIL is also set (Resend requires a verified domain)
const resend =
  process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

// When using Resend, FROM must come from a verified domain (set RESEND_FROM_EMAIL).
// When using Nodemailer (Gmail SMTP), FROM is EMAIL_USER.
const FROM_EMAIL = resend
  ? (process.env.RESEND_FROM_EMAIL as string)
  : (process.env.EMAIL_USER || "noreply@marius-fanny.com");

// Display name for outgoing emails
const DISPLAY_FROM = `"Marius & Fanny" <${process.env.EMAIL_USER || FROM_EMAIL}>`;

// Expéditeur "ne pas répondre" pour les courriels AUTOMATIQUES de commande
// (confirmations, reçus, factures). Le courriel part toujours du compte SMTP,
// mais l'affichage indique clairement de ne pas répondre.
const DISPLAY_FROM_NOREPLY = `"Marius & Fanny (Ne pas répondre)" <${process.env.EMAIL_USER || FROM_EMAIL}>`;

// Boîte de la boulangerie qui reçoit les RÉPONSES des clients (Reply-To) quand
// ils répondent à une confirmation — pour que Fanny voie ces messages sans
// accéder au compte d'envoi. On N'envoie PAS de copie des confirmations
// elles-mêmes (pas de BCC). Configurable via env.
const ORDER_CONTACT_EMAIL =
  (process.env.ORDER_CONTACT_EMAIL || "mariusetfanny@bellnet.ca").trim();

// Public logo URL (hosted on Cloudinary)
// Use f_jpg so the logo renders in every email client (AVIF is rejected by
// Outlook, several webmails, and older Apple Mail versions).
const LOGO_URL = "https://res.cloudinary.com/deyjooxbi/image/upload/f_jpg/v1773330080/branding/marius_fanny_logo.jpg";

// Google review link for post-order feedback.
const GOOGLE_REVIEW_PLACE_ID_LAVAL = (process.env.GOOGLE_REVIEW_PLACE_ID_LAVAL || "").trim();
const GOOGLE_REVIEW_URL =
  (GOOGLE_REVIEW_PLACE_ID_LAVAL
    ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(GOOGLE_REVIEW_PLACE_ID_LAVAL)}`
    : "https://www.google.com/maps/search/?api=1&query=Marius%20%26%20Fanny%20Laval");

const FRONTEND_URL =
  process.env.FRONTEND_URL || "https://marius-fanny-xi.vercel.app";

const buildInvoiceDownloadSection = (orderId?: string) => {
  if (!orderId) return "";
  const invoiceUrl = `${FRONTEND_URL}/facture/${orderId}`;
  return `
  <div style="background-color: #F9F7F2; padding: 16px 20px; border-radius: 8px; margin-top: 20px; border-left: 4px solid #337957; text-align: center;">
    <p style="color: #2D2A26; margin: 0 0 10px 0; font-weight: bold; font-size: 14px;">📄 Votre facture</p>
    <p style="color: #555; margin: 0 0 12px 0; font-size: 13px;">
      Téléchargez ou imprimez votre facture en cliquant sur le bouton ci-dessous.
    </p>
    <a href="${invoiceUrl}"
       style="display: inline-block; padding: 10px 24px; background-color: #337957; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">
      Télécharger la facture
    </a>
  </div>`;
};

const buildCancellationPolicySection = () => `
  <div style="background-color: #FFF4E6; padding: 16px 20px; border-radius: 8px; margin-top: 24px; border-left: 4px solid #C5A065;">
    <p style="color: #2D2A26; margin: 0 0 10px 0; font-weight: bold; font-size: 14px;">
      Politique d'annulation
    </p>
    <ul style="color: #555; margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.7;">
      <li>Annulation jusqu'à 48 h à l'avance : remboursement complet.</li>
      <li>Annulation 24 h à l'avance : 25 % du montant sera retenu.</li>
      <li>Annulation le jour même : aucun remboursement.</li>
    </ul>
  </div>
`;

// Réclamations notice — shown on every order confirmation (site + admin).
const buildClaimPolicySection = () => `
  <div style="background-color: #FDECEA; padding: 16px 20px; border-radius: 8px; margin-top: 24px; border-left: 4px solid #D9534F;">
    <p style="color: #2D2A26; margin: 0 0 8px 0; font-weight: bold; font-size: 14px;">
      ⚠️ Réclamations
    </p>
    <p style="color: #555; margin: 0; font-size: 14px; line-height: 1.6;">
      Toute réclamation doit être faite dans les 48 h et l'item concerné, même entamé, doit nous être rapporté.
    </p>
  </div>
`;

const buildGoogleReviewSection = () => `
  <div style="background-color: #FFF8E7; padding: 18px; border-radius: 8px; margin-top: 24px; border-left: 4px solid #C5A065; text-align: center;">
    <p style="color: #2D2A26; margin: 0; font-weight: bold;">
      Votre commande vous a plu ?
    </p>
    <p style="color: #555; margin: 8px 0 14px 0; font-size: 14px; line-height: 1.5;">
      Laissez-nous un avis sur Google, cela aide beaucoup Marius & Fanny.
    </p>
    <a href="${GOOGLE_REVIEW_URL}"
       style="display: inline-block; padding: 12px 22px; background-color: #C5A065; color: white; text-decoration: none; border-radius: 999px; font-weight: bold;">
      Laisser un avis Google
    </a>
  </div>
`;

/**
 * Send an email via Resend if API key is set, else fall back to Nodemailer.
 */
async function sendEmail(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  bcc?: string;
}): Promise<void> {
  if (resend) {
    const { error } = await resend.emails.send({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      ...(opts.bcc ? { bcc: opts.bcc } : {}),
    });
    if (error) throw new Error(`Resend error: ${error.message}`);
  } else {
    await transporter.sendMail({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      // Par défaut les réponses reviennent à l'expéditeur ; les courriels de
      // commande passent une adresse explicite (la boîte de Fanny).
      replyTo: opts.replyTo || opts.from,
      ...(opts.bcc ? { bcc: opts.bcc } : {}),
    });
  }
}

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || "587"),
  secure: process.env.EMAIL_PORT === "465", // true pour 465, false pour 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Tester la connexion
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ Erreur de configuration email:", error);
  } else {
    console.log("✅ Serveur email prêt à envoyer");
  }
});

// Template pour email de vérification
export async function sendVerificationEmail(
  email: string,
  name: string,
  verificationUrl: string,
  verificationCode?: string,
): Promise<void> {
  // Use the provided code or generate a mock one
  const code =
    verificationCode || Math.floor(100000 + Math.random() * 900000).toString();

  try {
    const mailOptions = {
      from: DISPLAY_FROM,
      to: email,
      subject: "✨ Confirmez votre email - Marius & Fanny",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F9F7F2; border-radius: 10px;">

          <div style="text-align: center; margin-bottom: 30px;">
            <img src="${LOGO_URL}" alt="Marius & Fanny" style="max-width: 120px; margin-bottom: 10px;" />
            <h1 style="color: #C5A065; font-family: 'Great Vibes', cursive; font-size: 40px; margin: 0;">
              Marius & Fanny
            </h1>
          </div>

          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h2 style="color: #2D2A26; text-align: center; margin-bottom: 20px;">
              Bienvenue ${name || "ami"} ! 👋
            </h2>

            <p style="color: #555; line-height: 1.6; text-align: center; margin-bottom: 30px;">
              Merci de vous être inscrit. Pour activer votre compte et commencer à utiliser nos services,
              veuillez confirmer votre adresse email en utilisant le code de vérification ci-dessous.
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <div style="background-color: #F9F7F2; padding: 20px; border-radius: 8px; border: 2px solid #C5A065;">
                <p style="color: #999; margin: 0 0 10px 0; font-size: 12px;">Votre code de vérification :</p>
                <p style="color: #C5A065; font-size: 28px; font-weight: bold; letter-spacing: 3px; margin: 0; font-family: monospace;">
                  ${code}
                </p>
              </div>
            </div>

            <p style="color: #999; text-align: center; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              Ce code expire dans <strong>24 heures</strong>.
            </p>

            <p style="color: #999; text-align: center; font-size: 12px; margin-top: 10px;">
              Si vous n'avez pas créé ce compte, ignorez cet email.
            </p>
          </div>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>© 2026 Marius & Fanny. Tous droits réservés.</p>
          </div>

        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Email de vérification envoyé:", info.response);
    return { success: true } as any;
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi de l'email:", error);
    throw error;
  }
}

/**
 * Send a professional (partner) order email directly to admin (no production/admin order entry).
 */
export async function sendProOrderEmailToAdmin(
  adminEmail: string,
  proOrder: any,
): Promise<void> {
  const orderNumber = String(proOrder?.orderNumber || "").trim();
  const client = proOrder?.clientInfo || {};
  const items: any[] = Array.isArray(proOrder?.items) ? proOrder.items : [];

  const itemsHtml = items
    .map((item) => {
      const qty = Number(item.quantity || 0);
      const name = String(item.productName || "").trim();
      const amount = Number(item.amount || 0);
      const options =
        item.selectedOptions && Object.keys(item.selectedOptions).length > 0
          ? Object.entries(item.selectedOptions)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" | ")
          : "";
      return `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee; color: #555;">
            <div style="font-weight: 600; color: #2D2A26;">${name}</div>
            ${options ? `<div style="font-size: 12px; color: #777; margin-top: 4px;">${options}</div>` : ""}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; color: #555;">
            ${qty}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right; color: #555;">
            ${amount.toFixed(2)}$
          </td>
        </tr>
      `;
    })
    .join("");

  const deliveryType = proOrder?.deliveryType === "delivery" ? "Livraison" : "Ramassage";
  const distanceTier =
    proOrder?.deliveryType === "delivery"
      ? proOrder?.deliveryDistanceTier === "gt20"
        ? "> 20 km"
        : "< 20 km"
      : "";

  const addr = proOrder?.deliveryAddress || null;
  const addressLine = addr
    ? `${addr.street || ""}, ${addr.city || ""}, ${addr.province || "QC"} ${addr.postalCode || ""}`.trim()
    : "";

  const mailOptions = {
    from: DISPLAY_FROM,
    to: adminEmail,
    subject: `Nouvelle commande PRO - ${orderNumber}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; background-color: #F9F7F2; border-radius: 10px;">
        <div style="text-align: center; margin-bottom: 18px;">
          <img src="${LOGO_URL}" alt="Marius & Fanny" style="max-width: 160px; height: auto;" />
        </div>

        <div style="background-color: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.08);">
          <h2 style="color: #2D2A26; margin: 0 0 10px 0;">Nouvelle commande PRO</h2>
          <p style="margin: 0 0 16px 0; color: #555;">
            <strong>Numéro:</strong> ${orderNumber}
          </p>

          <div style="background-color: #F9F7F2; padding: 14px; border-radius: 8px; margin-bottom: 18px;">
            <div style="color: #2D2A26; font-weight: bold; margin-bottom: 6px;">Client</div>
            <div style="color: #555; font-size: 14px;">
              ${client.firstName || ""} ${client.lastName || ""}<br/>
              ${client.email || ""}<br/>
              ${client.phone || ""}
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px;">
            <div style="background: #EAF6EF; border: 1px solid #CFE9D8; padding: 12px; border-radius: 8px;">
              <div style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #337957; font-weight: bold;">Type</div>
              <div style="margin-top: 4px; font-weight: bold; color: #2D2A26;">${deliveryType}</div>
              ${distanceTier ? `<div style="margin-top: 4px; font-size: 13px; color: #555;">Distance: <strong>${distanceTier}</strong></div>` : ""}
            </div>
            <div style="background: #FFF8E7; border: 1px solid #F1E2C4; padding: 12px; border-radius: 8px;">
              <div style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #C5A065; font-weight: bold;">Total</div>
              <div style="margin-top: 4px; font-weight: bold; color: #2D2A26;">${Number(proOrder?.total || 0).toFixed(2)}$</div>
              <div style="margin-top: 4px; font-size: 13px; color: #555;">
                Sous-total: ${Number(proOrder?.subtotal || 0).toFixed(2)}$ • Taxes: ${Number(proOrder?.taxAmount || 0).toFixed(2)}$ • Livraison: ${Number(proOrder?.deliveryFee || 0).toFixed(2)}$
              </div>
            </div>
          </div>

          ${
            addressLine
              ? `<div style="margin-bottom: 18px;">
                  <div style="font-weight: bold; color: #2D2A26; margin-bottom: 6px;">Adresse</div>
                  <div style="color: #555; font-size: 14px;">${addressLine}</div>
                </div>`
              : ""
          }

          <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
            <thead>
              <tr>
                <th style="text-align:left; padding: 10px; background:#2D2A26; color:white; font-size: 12px; letter-spacing: 0.06em;">Produit</th>
                <th style="text-align:center; padding: 10px; background:#2D2A26; color:white; font-size: 12px; letter-spacing: 0.06em;">Qté</th>
                <th style="text-align:right; padding: 10px; background:#2D2A26; color:white; font-size: 12px; letter-spacing: 0.06em;">Montant</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          ${proOrder?.notes ? `<div style="margin-top: 16px; color:#555; font-size: 14px;"><strong>Notes:</strong> ${String(proOrder.notes)}</div>` : ""}
        </div>
      </div>
    `,
  };

  await sendEmail(mailOptions);
}

// Template pour email de réinitialisation de mot de passe
export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string,
): Promise<void> {
  try {
    const mailOptions = {
      from: DISPLAY_FROM,
      to: email,
      subject: "🔐 Réinitialiser votre mot de passe - Marius & Fanny",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F9F7F2; border-radius: 10px;">

          <div style="text-align: center; margin-bottom: 30px;">
            <img src="${LOGO_URL}" alt="Marius & Fanny" style="max-width: 120px; margin-bottom: 10px;" />
            <h1 style="color: #C5A065; font-family: 'Great Vibes', cursive; font-size: 40px; margin: 0;">
              Marius & Fanny
            </h1>
          </div>

          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h2 style="color: #2D2A26; text-align: center; margin-bottom: 20px;">
              Réinitialiser votre mot de passe
            </h2>

            <p style="color: #555; line-height: 1.6; text-align: center; margin-bottom: 30px;">
              Vous avez demandé la réinitialisation de votre mot de passe.
              Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe.
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${URL}"
                 style="display: inline-block; padding: 15px 40px; background-color: #C5A065; color: white;
                        text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; transition: opacity 0.3s;">
                🔐 Réinitialiser le mot de passe
              </a>
            </div>

            <p style="color: #999; text-align: center; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              Ce lien expire dans <strong>1 heure</strong>.
            </p>

            <p style="color: #999; text-align: center; font-size: 12px; margin-top: 10px;">
              Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
            </p>
          </div>

        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Email de réinitialisation envoyé:", info.response);
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi de l'email:", error);
    throw error;
  }
}

export default transporter;

/**
 * Send partner request notification email to admin
 */
export async function sendPartnerRequestEmail(
  adminEmail: string,
  applicant: {
    businessName: string;
    contactName: string;
    email: string;
    phone: string;
    address: string;
  },
  approvalLink: string,
): Promise<void> {
  try {
    const mailOptions = {
      from: FROM_EMAIL,
      to: adminEmail,
      subject: `🤝 Nouvelle demande partenaire Pro - ${applicant.businessName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F9F7F2; border-radius: 10px;">

          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #337957; font-size: 32px; margin: 0;">
              Marius &amp; Fanny
            </h1>
            <p style="color: #888; font-size: 13px; margin-top: 4px;">Panneau d'administration</p>
          </div>

          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h2 style="color: #2D2A26; margin-bottom: 20px; border-bottom: 2px solid #337957; padding-bottom: 10px;">
              📋 Nouvelle demande de compte Pro
            </h2>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
              <tr>
                <td style="padding: 8px 12px; background: #F9F7F2; border-radius: 4px; color: #888; font-size: 12px; font-weight: bold; width: 40%;">ENTREPRISE</td>
                <td style="padding: 8px 12px; color: #2D2A26; font-size: 15px; font-weight: bold;">${applicant.businessName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 12px; color: #888; font-size: 12px; font-weight: bold;">CONTACT</td>
                <td style="padding: 8px 12px; color: #2D2A26; font-size: 15px;">${applicant.contactName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 12px; background: #F9F7F2; border-radius: 4px; color: #888; font-size: 12px; font-weight: bold;">EMAIL</td>
                <td style="padding: 8px 12px; background: #F9F7F2; color: #337957; font-size: 15px;">${applicant.email}</td>
              </tr>
              <tr>
                <td style="padding: 8px 12px; color: #888; font-size: 12px; font-weight: bold;">TÉLÉPHONE</td>
                <td style="padding: 8px 12px; color: #2D2A26; font-size: 15px;">${applicant.phone}</td>
              </tr>
              <tr>
                <td style="padding: 8px 12px; background: #F9F7F2; border-radius: 4px; color: #888; font-size: 12px; font-weight: bold;">ADRESSE</td>
                <td style="padding: 8px 12px; background: #F9F7F2; color: #2D2A26; font-size: 15px;">${applicant.address}</td>
              </tr>
            </table>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${approvalLink}"
                 style="display: inline-block; padding: 15px 40px; background-color: #337957; color: white;
                        text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                ✅ Approuver ce partenaire
              </a>
            </div>

            <p style="color: #999; text-align: center; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
              Ce lien d'approbation est valide pendant <strong>48 heures</strong>.
            </p>
            <p style="color: #bbb; text-align: center; font-size: 11px;">
              Si vous ne reconnaissez pas cette demande, ignorez simplement cet email.
            </p>
          </div>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>© 2026 Marius &amp; Fanny. Tous droits réservés.</p>
          </div>

        </div>
      `,
    };

    await sendEmail(mailOptions);
    console.log("✅ Email demande partenaire envoyé à l'admin");
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi de l'email admin:", error);
    throw error;
  }
}

/**
 * Send approval confirmation email to the new partner
 */
export async function sendPartnerApprovedEmail(
  email: string,
  contactName: string,
  businessName: string,
  loginUrl: string,
): Promise<void> {
  try {
    const mailOptions = {
      from: FROM_EMAIL,
      to: email,
      subject: `🎉 Votre compte Pro a été approuvé - Marius & Fanny`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F9F7F2; border-radius: 10px;">

          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #337957; font-size: 32px; margin: 0;">Marius &amp; Fanny</h1>
          </div>

          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 20px;">
              <div style="display: inline-block; background-color: #337957; color: white; padding: 10px 20px; border-radius: 20px; font-weight: bold; font-size: 14px;">
                ✅ COMPTE PRO APPROUVÉ
              </div>
            </div>

            <h2 style="color: #2D2A26; text-align: center; margin-bottom: 20px;">
              Félicitations ${contactName} ! 🎉
            </h2>

            <p style="color: #555; line-height: 1.6; text-align: center; margin-bottom: 25px;">
              Votre demande de compte professionnel pour <strong>${businessName}</strong> a été approuvée.
              Vous pouvez maintenant vous connecter et accéder à tous les avantages partenaires.
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${loginUrl}"
                 style="display: inline-block; padding: 15px 40px; background-color: #337957; color: white;
                        text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                🚀 Accéder à mon espace Pro
              </a>
            </div>

            <p style="color: #999; text-align: center; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
              Connectez-vous avec l'email <strong>${email}</strong> et le mot de passe que vous avez choisi lors de votre inscription.
            </p>
          </div>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>© 2026 Marius &amp; Fanny. Tous droits réservés.</p>
          </div>

        </div>
      `,
    };

    await sendEmail(mailOptions);
    console.log("✅ Email confirmation partenaire approuvé envoyé");
  } catch (error) {
    console.error("❌ Erreur envoi email approbation partenaire:", error);
    // Don't throw - approval should not fail because of email
  }
}

/**
 * Send partner inquiry notification email to admin (from homepage wholesale form)
 * This is a contact/inquiry — no account creation, just notification.
 */
export async function sendPartnerInquiryEmail(
  adminEmail: string,
  data: {
    companyName: string;
    contactName: string;
    email: string;
    phone: string;
    businessType: string;
    message: string;
  },
  inviteUrl: string,
): Promise<void> {
  try {
    const mailOptions = {
      from: `"Marius & Fanny - Espace Pro" <${FROM_EMAIL}>`,
      to: adminEmail,
      subject: `Nouvelle demande de renseignements Pro - ${data.companyName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F9F7F2; border-radius: 10px;">

          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #337957; font-size: 32px; margin: 0;">Marius &amp; Fanny</h1>
            <p style="color: #888; font-size: 13px; margin-top: 4px;">Espace Professionnel</p>
          </div>

          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h2 style="color: #2D2A26; margin-bottom: 20px; border-bottom: 2px solid #337957; padding-bottom: 10px;">
              📋 Demande de renseignements Pro
            </h2>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
              <tr>
                <td style="padding: 8px 12px; background: #F9F7F2; border-radius: 4px; color: #888; font-size: 12px; font-weight: bold; width: 40%;">ENTREPRISE</td>
                <td style="padding: 8px 12px; color: #2D2A26; font-size: 15px; font-weight: bold;">${data.companyName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 12px; color: #888; font-size: 12px; font-weight: bold;">CONTACT</td>
                <td style="padding: 8px 12px; color: #2D2A26; font-size: 15px;">${data.contactName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 12px; background: #F9F7F2; color: #888; font-size: 12px; font-weight: bold;">EMAIL</td>
                <td style="padding: 8px 12px; background: #F9F7F2; color: #337957; font-size: 15px;">${data.email}</td>
              </tr>
              <tr>
                <td style="padding: 8px 12px; color: #888; font-size: 12px; font-weight: bold;">TÉLÉPHONE</td>
                <td style="padding: 8px 12px; color: #2D2A26; font-size: 15px;">${data.phone}</td>
              </tr>
              <tr>
                <td style="padding: 8px 12px; background: #F9F7F2; color: #888; font-size: 12px; font-weight: bold;">TYPE D'ACTIVITÉ</td>
                <td style="padding: 8px 12px; background: #F9F7F2; color: #2D2A26; font-size: 15px;">${data.businessType}</td>
              </tr>
              ${data.message ? `
              <tr>
                <td style="padding: 8px 12px; color: #888; font-size: 12px; font-weight: bold; vertical-align: top;">MESSAGE</td>
                <td style="padding: 8px 12px; color: #2D2A26; font-size: 15px;">${data.message}</td>
              </tr>` : ""}
            </table>

            <div style="text-align: center; margin: 25px 0;">
              <a href="${inviteUrl}"
                 style="display: inline-block; padding: 14px 36px; background-color: #337957; color: white;
                        text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px;">
                ✅ Approuver le partenaire &amp; envoyer l'invitation
              </a>
            </div>

            <p style="color: #555; font-size: 13px; margin-top: 16px; padding-top: 16px; border-top: 1px solid #eee; text-align: center;">
              En cliquant ce bouton, le prospect recevra automatiquement un email l'invitant à compléter son inscription sur votre plateforme.
            </p>
          </div>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>© 2026 Marius &amp; Fanny. Tous droits réservés.</p>
          </div>

        </div>
      `,
    };

    await sendEmail(mailOptions);
    console.log("✅ Email demande renseignements pro envoyé à l'admin");
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi de l'email demande pro:", error);
    throw error;
  }
}

/**
 * Send partner invitation email to the prospect (triggered by admin approval of an inquiry)
 */
export async function sendPartnerInvitationEmail(
  prospectEmail: string,
  contactName: string,
  companyName: string,
  registrationUrl: string,
): Promise<void> {
  try {
    const mailOptions = {
      from: `"Marius & Fanny" <${FROM_EMAIL}>`,
      replyTo: "fanny.chiecchio@gmail.com",
      to: prospectEmail,
      subject: `Votre demande partenaire a été approuvée - Marius & Fanny`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F9F7F2; border-radius: 10px;">

          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #337957; font-size: 32px; margin: 0;">Marius &amp; Fanny</h1>
            <p style="color: #888; font-size: 13px; margin-top: 4px;">Espace Professionnel</p>
          </div>

          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 20px;">
              <div style="display: inline-block; background-color: #337957; color: white; padding: 10px 20px; border-radius: 20px; font-weight: bold; font-size: 14px;">
                ✅ DEMANDE APPROUVÉE
              </div>
            </div>

            <h2 style="color: #2D2A26; text-align: center; margin-bottom: 16px;">
              Bonjour ${contactName} 👋
            </h2>

            <p style="color: #555; line-height: 1.7; text-align: center; margin-bottom: 25px;">
              Nous avons examiné votre demande de partenariat pour <strong>${companyName}</strong> et nous sommes ravis de vous inviter à rejoindre notre réseau professionnel.
            </p>

            <p style="color: #555; line-height: 1.7; text-align: center; margin-bottom: 30px;">
              Pour finaliser la création de votre compte Pro, cliquez sur le bouton ci-dessous et complétez le formulaire d'inscription :
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${registrationUrl}"
                 style="display: inline-block; padding: 15px 40px; background-color: #337957; color: white;
                        text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                🚀 Créer mon compte Pro
              </a>
            </div>

            <p style="color: #999; text-align: center; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
              Si vous avez des questions, contactez-nous à <a href="mailto:fanny.chiecchio@gmail.com" style="color: #337957;">fanny.chiecchio@gmail.com</a>
            </p>
          </div>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>© 2026 Marius &amp; Fanny. Tous droits réservés.</p>
          </div>

        </div>
      `,
    };

    await sendEmail(mailOptions);
    console.log("✅ Email invitation partenaire envoyé vers:", prospectEmail);
  } catch (error) {
    console.error("❌ Erreur envoi email invitation partenaire:", error);
    throw error;
  }
}

/**
 * Send full payment receipt email
 */
const buildClientNoteSection = (note?: string) => {
  if (!note || !note.trim()) return "";
  return `
  <div style="background-color: #FFF8E7; padding: 16px 20px; border-radius: 8px; margin-top: 24px; border-left: 4px solid #C5A065;">
    <p style="color: #2D2A26; margin: 0 0 8px 0; font-weight: bold; font-size: 14px;">📝 Note importante</p>
    <p style="color: #555; margin: 0; font-size: 14px; line-height: 1.6; white-space: pre-line;">${note.trim()}</p>
  </div>`;
};

export async function sendFullPaymentReceipt(
  email: string,
  name: string,
  orderNumber: string,
  items: Array<{ productName: string; quantity: number; amount: number }>,
  subtotal: number,
  taxAmount: number,
  deliveryFee: number,
  total: number,
  paymentId: string,
  orderDate?: Date,
  pickupDate?: Date,
  pickupTimeSlot?: string,
  deliveryType?: "pickup" | "delivery",
  clientNote?: string,
  orderId?: string,
): Promise<void> {
  try {
    const itemsHtml = items
      .map(
        (item) => `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee; color: #555;">
            ${item.productName}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; color: #555;">
            ${item.quantity}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right; color: #555;">
            ${item.amount.toFixed(2)}$
          </td>
        </tr>
      `
      )
      .join("");

    const orderDateObj = orderDate ? new Date(orderDate) : new Date();
    const formattedDate = orderDateObj.toLocaleDateString("fr-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Montreal" });
    const formattedTime = orderDateObj.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit", timeZone: "America/Montreal" });
    const paddedNumber = orderNumber.split("-").pop() || orderNumber;
    const pickupDateObj = pickupDate ? new Date(pickupDate) : null;
    const formattedPickupDate = pickupDateObj
      ? pickupDateObj.toLocaleDateString("fr-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Montreal" })
      : null;
    const pickupSection = formattedPickupDate
      ? `<div style="background-color: #EAF6EF; border: 2px solid #337957; border-radius: 10px; padding: 16px; margin-top: 16px; text-align: center;">
          <p style="color: #337957; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0;">📅 ${deliveryType === "delivery" ? "Date de livraison" : "Date de ramassage"}</p>
          <p style="color: #2D2A26; font-size: 18px; font-weight: bold; margin: 0;">${formattedPickupDate}</p>
          ${pickupTimeSlot ? `<p style="color: #337957; font-size: 15px; margin: 6px 0 0 0;">⏰ Heure : <strong>${pickupTimeSlot}</strong></p>` : ""}
        </div>`
      : "";

    const mailOptions = {
      from: DISPLAY_FROM_NOREPLY,
      replyTo: ORDER_CONTACT_EMAIL,
      to: email,
      subject: `✅ Confirmation de paiement - Commande ${paddedNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F9F7F2; border-radius: 10px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="${LOGO_URL}" alt="Marius & Fanny" style="max-width: 180px; height: auto;" />
          </div>

          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 20px;">
              <div style="display: inline-block; background-color: #4CAF50; color: white; padding: 10px 20px; border-radius: 20px; font-weight: bold;">
                ✅ PAIEMENT COMPLET REÇU
              </div>
            </div>

            <h2 style="color: #2D2A26; text-align: center; margin-bottom: 20px;">
              Merci ${name} ! 🎉
            </h2>

            <p style="color: #555; line-height: 1.6; text-align: center; margin-bottom: 30px;">
              Votre commande a été confirmée et votre paiement complet a été reçu avec succès.
            </p>

            <div style="background-color: #F9F7F2; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
              <p style="color: #999; margin: 0 0 5px 0; font-size: 12px;">Numéro de commande</p>
              <p style="color: #C5A065; font-size: 24px; font-weight: bold; margin: 0;">${paddedNumber}</p>
              <p style="color: #999; margin: 10px 0 5px 0; font-size: 12px;">Date de commande</p>
              <p style="color: #555; margin: 0; font-size: 14px;">${formattedDate} à ${formattedTime}</p>
              <p style="color: #999; margin: 10px 0 0 0; font-size: 12px;">ID de paiement: ${paymentId}</p>
              ${pickupSection}
            </div>

            <h3 style="color: #2D2A26; border-bottom: 2px solid #C5A065; padding-bottom: 10px;">
              Détails de la commande
            </h3>

            <table style="width: 100%; margin-bottom: 20px; border-collapse: collapse;">
              <thead>
                <tr style="background-color: #F9F7F2;">
                  <th style="padding: 10px; text-align: left; color: #2D2A26;">Produit</th>
                  <th style="padding: 10px; text-align: center; color: #2D2A26;">Qté</th>
                  <th style="padding: 10px; text-align: right; color: #2D2A26;">Prix</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <div style="text-align: right; margin-top: 20px;">
              <p style="color: #555; margin: 5px 0;">
                <span style="display: inline-block; width: 150px;">Sous-total:</span>
                <strong>${subtotal.toFixed(2)}$</strong>
              </p>
              <p style="color: #555; margin: 5px 0;">
                <span style="display: inline-block; width: 150px;">TPS (5 %):</span>
                <strong>${(taxAmount * (0.05 / 0.14975)).toFixed(2)}$</strong>
              </p>
              <p style="color: #555; margin: 5px 0;">
                <span style="display: inline-block; width: 150px;">TVQ (9,975 %):</span>
                <strong>${(taxAmount * (0.09975 / 0.14975)).toFixed(2)}$</strong>
              </p>
              <p style="color: #999; margin: 2px 0 10px 0; font-size: 11px;">
                <span style="display: inline-block; width: 150px;">&nbsp;</span>
                TPS: 144652641RT001 &nbsp;&nbsp; TVQ: 1201862732TQ0001
              </p>
              ${
                deliveryFee > 0
                  ? `
              <p style="color: #555; margin: 5px 0;">
                <span style="display: inline-block; width: 150px;">Livraison:</span>
                <strong>${deliveryFee.toFixed(2)}$</strong>
              </p>
              `
                  : ""
              }
              <p style="color: #C5A065; font-size: 20px; margin: 15px 0 0 0; padding-top: 10px; border-top: 2px solid #C5A065;">
                <span style="display: inline-block; width: 150px;">Total payé:</span>
                <strong>${total.toFixed(2)}$</strong>
              </p>
            </div>

            <div style="background-color: #E8F5E9; padding: 15px; border-radius: 8px; margin-top: 30px; border-left: 4px solid #4CAF50;">
              <p style="color: #2D7D32; margin: 0; font-weight: bold;">
                Paiement complet effectué
              </p>
              <p style="color: #555; margin: 5px 0 0 0; font-size: 14px;">
                Votre commande est maintenant en cours de préparation.
              </p>
            </div>

            ${buildInvoiceDownloadSection(orderId)}

            ${buildClientNoteSection(clientNote)}

            ${buildClaimPolicySection()}

            ${buildCancellationPolicySection()}

            ${buildGoogleReviewSection()}
          </div>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>© 2026 Marius & Fanny. Tous droits réservés.</p>
          </div>
        </div>
      `,
    };

    await sendEmail(mailOptions);
    console.log("✅ Reçu de paiement complet envoyé vers:", email);
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi du reçu:", error);
    throw error;
  }
}

/**
 * Send deposit payment receipt email
 */
export async function sendDepositReceipt(
  email: string,
  name: string,
  orderNumber: string,
  items: Array<{ productName: string; quantity: number; amount: number }>,
  subtotal: number,
  taxAmount: number,
  deliveryFee: number,
  total: number,
  depositPaid: number,
  balanceDue: number,
  paymentId: string,
  orderDate?: Date,
  pickupDate?: Date,
  pickupTimeSlot?: string,
  deliveryType?: "pickup" | "delivery",
  clientNote?: string,
  orderId?: string,
): Promise<void> {
  try {
    const itemsHtml = items
      .map(
        (item) => `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee; color: #555;">
            ${item.productName}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; color: #555;">
            ${item.quantity}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right; color: #555;">
            ${item.amount.toFixed(2)}$
          </td>
        </tr>
      `
      )
      .join("");

    const orderDateObj = orderDate ? new Date(orderDate) : new Date();
    const formattedDate = orderDateObj.toLocaleDateString("fr-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/Montreal",
    });
    const formattedTime = orderDateObj.toLocaleTimeString("fr-CA", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Montreal",
    });
    const paddedNumber = orderNumber.split("-").pop() || orderNumber;

    const pickupDateObjD = pickupDate ? new Date(pickupDate) : null;
    const formattedPickupDateD = pickupDateObjD
      ? pickupDateObjD.toLocaleDateString("fr-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Montreal" })
      : null;
    const pickupSectionD = formattedPickupDateD
      ? `<div style="background-color: #EAF6EF; border: 2px solid #337957; border-radius: 10px; padding: 16px; margin-top: 16px; text-align: center;">
          <p style="color: #337957; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0;">📅 ${deliveryType === "delivery" ? "Date de livraison" : "Date de ramassage"}</p>
          <p style="color: #2D2A26; font-size: 18px; font-weight: bold; margin: 0;">${formattedPickupDateD}</p>
          ${pickupTimeSlot ? `<p style="color: #337957; font-size: 15px; margin: 6px 0 0 0;">⏰ Heure : <strong>${pickupTimeSlot}</strong></p>` : ""}
        </div>`
      : "";

    const mailOptions = {
      from: DISPLAY_FROM_NOREPLY,
      replyTo: ORDER_CONTACT_EMAIL,
      to: email,
      subject: `✅ Acompte reçu - Commande ${paddedNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F9F7F2; border-radius: 10px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="${LOGO_URL}" alt="Marius & Fanny" style="max-width: 180px; height: auto;" />
          </div>

          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 20px;">
              <div style="display: inline-block; background-color: #FF9800; color: white; padding: 10px 20px; border-radius: 20px; font-weight: bold;">
                💰 ACOMPTE REÇU (50%)
              </div>
            </div>

            <h2 style="color: #2D2A26; text-align: center; margin-bottom: 20px;">
              Merci ${name} ! 🎉
            </h2>

            <p style="color: #555; line-height: 1.6; text-align: center; margin-bottom: 30px;">
              Votre commande a été confirmée et votre acompte de 50% a été reçu avec succès.
            </p>

            <div style="background-color: #F9F7F2; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
              <p style="color: #999; margin: 0 0 5px 0; font-size: 12px;">Numéro de commande</p>
              <p style="color: #C5A065; font-size: 28px; font-weight: bold; margin: 0; letter-spacing: 2px; font-family: monospace;">${paddedNumber}</p>
              <p style="color: #999; margin: 10px 0 5px 0; font-size: 12px;">Date de commande</p>
              <p style="color: #555; margin: 0; font-size: 14px;">${formattedDate} à ${formattedTime}</p>
              <p style="color: #999; margin: 10px 0 0 0; font-size: 12px;">ID de paiement: ${paymentId}</p>
              ${pickupSectionD}
            </div>

            <h3 style="color: #2D2A26; border-bottom: 2px solid #C5A065; padding-bottom: 10px;">
              Détails de la commande
            </h3>

            <table style="width: 100%; margin-bottom: 20px; border-collapse: collapse;">
              <thead>
                <tr style="background-color: #F9F7F2;">
                  <th style="padding: 10px; text-align: left; color: #2D2A26;">Produit</th>
                  <th style="padding: 10px; text-align: center; color: #2D2A26;">Qté</th>
                  <th style="padding: 10px; text-align: right; color: #2D2A26;">Prix</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <div style="text-align: right; margin-top: 20px;">
              <p style="color: #555; margin: 5px 0;">
                <span style="display: inline-block; width: 180px;">Sous-total:</span>
                <strong>${subtotal.toFixed(2)}$</strong>
              </p>
              <p style="color: #555; margin: 5px 0;">
                <span style="display: inline-block; width: 180px;">TPS (5 %):</span>
                <strong>${(taxAmount * (0.05 / 0.14975)).toFixed(2)}$</strong>
              </p>
              <p style="color: #555; margin: 5px 0;">
                <span style="display: inline-block; width: 180px;">TVQ (9,975 %):</span>
                <strong>${(taxAmount * (0.09975 / 0.14975)).toFixed(2)}$</strong>
              </p>
              <p style="color: #999; margin: 2px 0 10px 0; font-size: 11px;">
                <span style="display: inline-block; width: 180px;">&nbsp;</span>
                TPS: 144652641RT001 &nbsp;&nbsp; TVQ: 1201862732TQ0001
              </p>
              ${
                deliveryFee > 0
                  ? `
              <p style="color: #555; margin: 5px 0;">
                <span style="display: inline-block; width: 180px;">Livraison:</span>
                <strong>${deliveryFee.toFixed(2)}$</strong>
              </p>
              `
                  : ""
              }
              <p style="color: #2D2A26; font-size: 18px; margin: 15px 0 0 0; padding-top: 10px; border-top: 2px solid #C5A065;">
                <span style="display: inline-block; width: 180px;">Total:</span>
                <strong>${total.toFixed(2)}$</strong>
              </p>
              <p style="color: #4CAF50; font-size: 16px; margin: 10px 0 0 0;">
                <span style="display: inline-block; width: 180px;">Acompte payé (50%):</span>
                <strong>${depositPaid.toFixed(2)}$</strong>
              </p>
              <p style="color: #FF9800; font-size: 20px; margin: 10px 0 0 0; padding-top: 10px; border-top: 1px solid #eee;">
                <span style="display: inline-block; width: 180px;">Solde dû:</span>
                <strong>${balanceDue.toFixed(2)}$</strong>
              </p>
            </div>

            <div style="background-color: #FFF3E0; padding: 15px; border-radius: 8px; margin-top: 30px; border-left: 4px solid #FF9800;">
              <p style="color: #E65100; margin: 0; font-weight: bold;">
                ⚠️ Solde à payer lors du ramassage/livraison
              </p>
              <p style="color: #555; margin: 5px 0 0 0; font-size: 14px;">
                Un montant de <strong>${balanceDue.toFixed(2)}$</strong> sera dû lors de la récupération ou de la livraison de votre commande.
              </p>
            </div>

            ${buildInvoiceDownloadSection(orderId)}

            ${buildClientNoteSection(clientNote)}

            ${buildClaimPolicySection()}

            ${buildCancellationPolicySection()}

            ${buildGoogleReviewSection()}
          </div>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>© 2026 Marius & Fanny. Tous droits réservés.</p>
          </div>
        </div>
      `,
    };

    await sendEmail(mailOptions);
    console.log("✅ Reçu d'acompte envoyé vers:", email);
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi du reçu d'acompte:", error);
    throw error;
  }
}

/**
 * Send order confirmation for invoice payment
 */
export async function sendInvoiceOrderConfirmation(
  email: string,
  name: string,
  orderNumber: string,
  items: Array<{ productName: string; quantity: number; amount: number }>,
  subtotal: number,
  taxAmount: number,
  deliveryFee: number,
  total: number,
  invoiceUrl?: string,
  orderDate?: Date,
  pickupDate?: Date,
  pickupTimeSlot?: string,
  deliveryType?: "pickup" | "delivery",
  clientNote?: string,
  orderId?: string,
  asFacture: boolean = false,
  hideBreakdown: boolean = false,
  organization?: string,
): Promise<void> {
  try {
    const itemsHtml = items
      .map(
        (item) => `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee; color: #555;">
            ${item.productName}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; color: #555;">
            ${item.quantity}
          </td>
          ${hideBreakdown ? "" : `<td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right; color: #555;">
            ${item.amount.toFixed(2)}$
          </td>`}
        </tr>
      `
      )
      .join("");

    const orderDateObj = orderDate ? new Date(orderDate) : new Date();
    const formattedDate = orderDateObj.toLocaleDateString("fr-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/Montreal",
    });
    const formattedTime = orderDateObj.toLocaleTimeString("fr-CA", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Montreal",
    });
    const paddedNumber = orderNumber.split("-").pop() || orderNumber;

    const pickupDateObjI = pickupDate ? new Date(pickupDate) : null;
    const formattedPickupDateI = pickupDateObjI
      ? pickupDateObjI.toLocaleDateString("fr-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Montreal" })
      : null;
    const pickupSectionI = formattedPickupDateI
      ? `<div style="background-color: #EAF6EF; border: 2px solid #337957; border-radius: 10px; padding: 16px; margin-top: 16px; text-align: center;">
          <p style="color: #337957; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0;">📅 ${deliveryType === "delivery" ? "Date de livraison" : "Date de ramassage"}</p>
          <p style="color: #2D2A26; font-size: 18px; font-weight: bold; margin: 0;">${formattedPickupDateI}</p>
          ${pickupTimeSlot ? `<p style="color: #337957; font-size: 15px; margin: 6px 0 0 0;">⏰ Heure : <strong>${pickupTimeSlot}</strong></p>` : ""}
        </div>`
      : "";

    // The whole price section (tax breakdown + Total) = the "facture". Hidden
    // entirely for a plain confirmation (hideBreakdown=true, e.g. the gov
    // contact email) → products + date only, no prices, no total. The amount
    // lives only on the facture (the city's billing copy).
    const totalsSection = hideBreakdown
      ? ""
      : `
            <div style="text-align: right; margin-top: 20px;">
              <p style="color: #555; margin: 5px 0;">
                <span style="display: inline-block; width: 150px;">Sous-total:</span>
                <strong>${subtotal.toFixed(2)}$</strong>
              </p>
              <p style="color: #555; margin: 5px 0;">
                <span style="display: inline-block; width: 150px;">TPS (5 %):</span>
                <strong>${(taxAmount * (0.05 / 0.14975)).toFixed(2)}$</strong>
              </p>
              <p style="color: #555; margin: 5px 0;">
                <span style="display: inline-block; width: 150px;">TVQ (9,975 %):</span>
                <strong>${(taxAmount * (0.09975 / 0.14975)).toFixed(2)}$</strong>
              </p>
              <p style="color: #999; margin: 2px 0 10px 0; font-size: 11px;">
                <span style="display: inline-block; width: 150px;">&nbsp;</span>
                TPS: 144652641RT001 &nbsp;&nbsp; TVQ: 1201862732TQ0001
              </p>
              ${deliveryFee > 0 ? `<p style="color: #555; margin: 5px 0;"><span style="display: inline-block; width: 150px;">Livraison:</span><strong>${deliveryFee.toFixed(2)}$</strong></p>` : ""}
              <p style="color: #C5A065; font-size: 20px; margin: 15px 0 0 0; padding-top: 10px; border-top: 2px solid #C5A065;">
                <span style="display: inline-block; width: 150px;">Total:</span>
                <strong>${total.toFixed(2)}$</strong>
              </p>
            </div>`;

    const mailOptions = {
      from: DISPLAY_FROM_NOREPLY,
      replyTo: ORDER_CONTACT_EMAIL,
      to: email,
      subject: asFacture
        ? `🧾 Facture - Commande ${paddedNumber}`
        : `📋 Confirmation de commande - ${paddedNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F9F7F2; border-radius: 10px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="${LOGO_URL}" alt="Marius & Fanny" style="max-width: 180px; height: auto;" />
          </div>

          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 20px;">
              <div style="display: inline-block; background-color: #2196F3; color: white; padding: 10px 20px; border-radius: 20px; font-weight: bold;">
                ${asFacture ? "🧾 FACTURE" : "📋 COMMANDE CONFIRMÉE"}
              </div>
            </div>

            <h2 style="color: #2D2A26; text-align: center; margin-bottom: 20px;">
              Merci ${name} ! 🎉
            </h2>

            <p style="color: #555; line-height: 1.6; text-align: center; margin-bottom: 30px;">
              Votre commande chez <strong>Marius &amp; Fanny</strong> a bien été confirmée.${invoiceUrl ? `
              Vous pouvez finaliser votre paiement en ligne à l'aide du bouton ci-dessous.` : ""}
            </p>

            <div style="background-color: #F9F7F2; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
              ${organization ? `<p style="color: #999; margin: 0 0 5px 0; font-size: 12px;">Organisation</p>
              <p style="color: #2D2A26; font-size: 16px; font-weight: bold; margin: 0 0 12px 0;">${organization}</p>` : ""}
              <p style="color: #999; margin: 0 0 5px 0; font-size: 12px;">Numéro de commande</p>
              <p style="color: #C5A065; font-size: 28px; font-weight: bold; margin: 0; letter-spacing: 2px; font-family: monospace;">${paddedNumber}</p>
              <p style="color: #999; margin: 10px 0 5px 0; font-size: 12px;">Date de commande</p>
              <p style="color: #555; margin: 0; font-size: 14px;">${formattedDate} à ${formattedTime}</p>
              ${pickupSectionI}
            </div>

            <h3 style="color: #2D2A26; border-bottom: 2px solid #C5A065; padding-bottom: 10px;">
              Détails de la commande
            </h3>

            <table style="width: 100%; margin-bottom: 20px; border-collapse: collapse;">
              <thead>
                <tr style="background-color: #F9F7F2;">
                  <th style="padding: 10px; text-align: left; color: #2D2A26;">Produit</th>
                  <th style="padding: 10px; text-align: center; color: #2D2A26;">Qté</th>
                  ${hideBreakdown ? "" : `<th style="padding: 10px; text-align: right; color: #2D2A26;">Prix</th>`}
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            ${totalsSection}

            ${invoiceUrl ? `
            <div style="background-color: #E3F2FD; padding: 15px; border-radius: 8px; margin-top: 30px; border-left: 4px solid #2196F3;">
              <p style="color: #0D47A1; margin: 0; font-weight: bold;">
                💳 Lien de paiement sécurisé
              </p>
              <p style="color: #555; margin: 5px 0 0 0; font-size: 14px;">
                Utilisez ce lien pour régler votre commande en toute sécurité.
              </p>
              <div style="text-align: center; margin-top: 15px;">
                <a href="${invoiceUrl}"
                   style="display: inline-block; padding: 12px 30px; background-color: #2196F3; color: white;
                          text-decoration: none; border-radius: 5px; font-weight: bold;">
                  Régler ma commande
                </a>
              </div>
            </div>
            ` : ""}

            ${hideBreakdown ? "" : buildInvoiceDownloadSection(orderId)}

            ${buildClientNoteSection(clientNote)}

            ${buildClaimPolicySection()}

            ${buildCancellationPolicySection()}

            ${buildGoogleReviewSection()}
          </div>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>© 2026 Marius & Fanny. Tous droits réservés.</p>
          </div>
        </div>
      `,
    };

    await sendEmail(mailOptions);
    console.log("✅ Confirmation de commande envoyée vers:", email);
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi de la confirmation:", error);
    throw error;
  }
}

/**
 * Template pour email de rappel de paiement (1 semaine ou 48h avant échéance)
 */
export async function sendPaymentReminderEmail(
  email: string,
  name: string,
  orderNumber: string,
  total: number,
  daysUntilDue: number,
  billingType: string,
  reminderPeriod: string
): Promise<void> {
  try {
    const formattedTotal = total.toFixed(2);
    const urgencyColor = daysUntilDue <= 2 ? "#D32F2F" : "#F57C00";
    const urgencyText = daysUntilDue <= 2 
      ? "⚠️ URGENT - Paiement requis dans 48 heures" 
      : "⏰ Rappel - Paiement à venir";

    const mailOptions = {
      from: DISPLAY_FROM,
      to: email,
      subject: daysUntilDue <= 2 
        ? `🔴 URGENT: Paiement requis dans 48h - Commande ${orderNumber}`
        : `Rappel: Paiement à effectuer - Commande ${orderNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="${LOGO_URL}" alt="Marius & Fanny" style="max-width: 200px;" />
          </div>

          <div style="background-color: #FFF3E0; padding: 20px; border-radius: 8px; border-left: 4px solid ${urgencyColor}; margin-bottom: 20px;">
            <h2 style="color: ${urgencyColor}; margin: 0 0 10px 0;">
              ${urgencyText}
            </h2>
            <p style="color: #333; margin: 0;">
             Bonjour ${name},<br/><br/>
              Nous vous rappelons que votre commande <strong>${orderNumber}</strong> doit être réglée ${reminderPeriod === "une semaine" ? "d'ici une semaine" : "dans les prochaines 48 heures"}.
            </p>
          </div>

          <div style="background-color: #F5F5F5; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #333; margin: 0 0 15px 0; border-bottom: 2px solid #C5A065; padding-bottom: 10px;">
              Détails de la commande
            </h3>
            <p style="color: #555; margin: 8px 0;">
              <span style="display: inline-block; width: 120px;">Numéro de commande:</span>
              <strong>${orderNumber}</strong>
            </p>
            <p style="color: #555; margin: 8px 0;">
              <span style="display: inline-block; width: 120px;">Type de client:</span>
              <strong>${billingType}</strong>
            </p>
            <p style="color: #C5A065; font-size: 24px; margin: 15px 0 0 0;">
              <span style="display: inline-block; width: 120px;">Total à payer:</span>
              <strong>${formattedTotal}$</strong>
            </p>
          </div>

          <div style="background-color: #E8F5E9; padding: 15px; border-radius: 8px; border-left: 4px solid #4CAF50;">
            <p style="color: #2E7D32; margin: 0; font-weight: bold;">
              📧 Comment payer ?
            </p>
            <p style="color: #555; margin: 10px 0 0 0; font-size: 14px;">
              Cliquez sur le bouton ci-dessous pour procéder au paiement sécurisé:
            </p>
            <div style="text-align: center; margin-top: 15px;">
              <a href="https://marius-fanny.com/account/orders" 
                 style="display: inline-block; padding: 12px 30px; background-color: #337957; color: white;
                        text-decoration: none; border-radius: 5px; font-weight: bold;">
                Régler ma commande
              </a>
            </div>
          </div>

          <p style="color: #666; font-size: 14px; margin-top: 25px; text-align: center;">
            Si vous avez déjà effectué le paiement, veuillez ignorer ce message.
            <br/>Pour toute question, contactez-nous à <a href="mailto:mariusetfanny@gmail.com" style="color: #C5A065;">mariusetfanny@gmail.com</a>
          </p>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>© 2026 Marius & Fanny. Tous droits réservés.</p>
          </div>
        </div>
      `,
    };

    await sendEmail(mailOptions);
    console.log("✅ Rappel de paiement envoyé vers:", email);
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi du rappel de paiement:", error);
    throw error;
  }
}

/**
 * Template pour email de paiement en retard (après la date d'échéance)
 */
export async function sendPaymentOverdueEmail(
  email: string,
  name: string,
  orderNumber: string,
  total: number,
  daysOverdue: number,
  billingType: string
): Promise<void> {
  try {
    const formattedTotal = total.toFixed(2);

    const mailOptions = {
      from: DISPLAY_FROM,
      to: email,
      subject: `⚠️ ALERTE: Paiement en retard - Commande ${orderNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="${LOGO_URL}" alt="Marius & Fanny" style="max-width: 200px;" />
          </div>

          <div style="background-color: #FFEBEE; padding: 20px; border-radius: 8px; border-left: 4px solid #D32F2F; margin-bottom: 20px;">
            <h2 style="color: #D32F2F; margin: 0 0 10px 0;">
              ⚠️ ALERTE: Paiement en retard
            </h2>
            <p style="color: #333; margin: 0;">
              Bonjour ${name},<br/><br/>
              Nous vous informons que le paiement de votre commande <strong>${orderNumber}</strong> est en retard de <strong style="color: #D32F2F;">${daysOverdue} jour${daysOverdue > 1 ? 's' : ''}</strong>.
            </p>
          </div>

          <div style="background-color: #F5F5F5; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #333; margin: 0 0 15px 0; border-bottom: 2px solid #C5A065; padding-bottom: 10px;">
              Détails de la commande
            </h3>
            <p style="color: #555; margin: 8px 0;">
              <span style="display: inline-block; width: 120px;">Numéro de commande:</span>
              <strong>${orderNumber}</strong>
            </p>
            <p style="color: #555; margin: 8px 0;">
              <span style="display: inline-block; width: 120px;">Type de client:</span>
              <strong>${billingType}</strong>
            </p>
            <p style="color: #D32F2F; font-size: 24px; margin: 15px 0 0 0;">
              <span style="display: inline-block; width: 120px;">Total en retard:</span>
              <strong>${formattedTotal}$</strong>
            </p>
          </div>

          <div style="background-color: #FFCDD2; padding: 15px; border-radius: 8px; border-left: 4px solid #D32F2F; margin-bottom: 20px;">
            <p style="color: #D32F2F; margin: 0; font-weight: bold;">
              ⚠️ Action requise
            </p>
            <p style="color: #555; margin: 10px 0 0 0; font-size: 14px;">
              Votre commande sera <strong>annulée automatiquement</strong> si le paiement n'est pas reçu dans les plus brefs délais.
              Veuillez procéder au paiement immédiatement pour éviter l'annulation de votre commande.
            </p>
          </div>

          <div style="text-align: center; margin-top: 20px;">
            <a href="https://marius-fanny.com/account/orders" 
               style="display: inline-block; padding: 14px 40px; background-color: #D32F2F; color: white;
                      text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">
              PAYER IMMÉDIATEMENT
            </a>
          </div>

          <p style="color: #666; font-size: 14px; margin-top: 25px; text-align: center;">
            Pour toute question ou si vous avez besoin d'un délai supplémentaire, contactez-nous rapidement à 
            <a href="mailto:mariusetfanny@gmail.com" style="color: #C5A065;">mariusetfanny@gmail.com</a>
          </p>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>© 2026 Marius & Fanny. Tous droits réservés.</p>
          </div>
        </div>
      `,
    };

    await sendEmail(mailOptions);
    console.log("✅ Email de paiement en retard envoyé vers:", email);
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi de l'email de paiement en retard:", error);
    throw error;
  }
}

/**
 * Send a contact form message to the admin
 */
export async function sendContactEmail(data: {
  firstName: string;
  lastName: string;
  email: string;
  subject: string;
  message: string;
  cvFilename?: string;
  cvBuffer?: Buffer;
  cvMimetype?: string;
  recipient?: string;
}): Promise<void> {
  const isCareer = data.subject === "Carrière";

  const attachments: any[] = [];
  if (isCareer && data.cvBuffer && data.cvFilename) {
    attachments.push({
      filename: data.cvFilename,
      content: data.cvBuffer,
      contentType: data.cvMimetype || "application/pdf",
    });
  }

  const mailOptions = {
    from: DISPLAY_FROM,
    to: data.recipient || "mariusetfanny@bellnet.ca",
    subject: `📩 Nouveau message — ${data.subject}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F9F7F2; border-radius: 10px;">

        <div style="text-align: center; margin-bottom: 30px;">
          <img src="${LOGO_URL}" alt="Marius & Fanny" style="max-width: 120px; margin-bottom: 10px;" />
          <h1 style="color: #C5A065; font-family: 'Great Vibes', cursive; font-size: 36px; margin: 0;">
            Marius & Fanny
          </h1>
        </div>

        <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #337957; margin: 0; font-size: 22px;">
              ${isCareer ? "📄 Candidature reçue" : "📩 Nouveau message de contact"}
            </h2>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; color: #337957; width: 130px;">Nom</td>
              <td style="padding: 10px; border-bottom: 1px solid #eee; color: #2D2A26;">${data.firstName} ${data.lastName}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; color: #337957;">Email</td>
              <td style="padding: 10px; border-bottom: 1px solid #eee; color: #2D2A26;">
                <a href="mailto:${data.email}" style="color: #337957;">${data.email}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; color: #337957;">Sujet</td>
              <td style="padding: 10px; border-bottom: 1px solid #eee; color: #2D2A26;">${data.subject}</td>
            </tr>
            ${isCareer && data.cvFilename ? `
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; color: #337957;">CV</td>
              <td style="padding: 10px; border-bottom: 1px solid #eee; color: #2D2A26;">📎 ${data.cvFilename} (en pièce jointe)</td>
            </tr>
            ` : ""}
          </table>

          <div style="background-color: #F9F7F2; padding: 16px; border-radius: 8px; border-left: 4px solid #337957;">
            <p style="font-weight: bold; color: #337957; margin: 0 0 8px 0; font-size: 13px;">MESSAGE :</p>
            <p style="color: #2D2A26; margin: 0; line-height: 1.6; white-space: pre-wrap;">${data.message}</p>
          </div>

          <div style="text-align: center; margin-top: 24px;">
            <a href="mailto:${data.email}?subject=Re: ${encodeURIComponent(data.subject)}"
               style="display: inline-block; padding: 12px 28px; background-color: #337957; color: white; text-decoration: none; border-radius: 999px; font-weight: bold; font-size: 14px;">
              Répondre à ${data.firstName}
            </a>
          </div>
        </div>

        <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
          <p>© ${new Date().getFullYear()} Marius &amp; Fanny. Tous droits réservés.</p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail({ ...mailOptions, replyTo: data.email, attachments });
  console.log("✅ Email de contact envoyé à mariusetfanny@bellnet.ca");
}

/**
 * Send order modification balance email to the client
 */
export async function sendOrderBalanceEmail(data: {
  clientName: string;
  clientEmail: string;
  orderNumber: string;
  oldTotal: number;
  newTotal: number;
  amountPaid: number;
  balance: number;
  items: { name: string; quantity: number; unitPrice: number; amount: number }[];
}): Promise<void> {
  const isRefund = data.balance < 0;
  const absBalance = Math.abs(data.balance);

  const itemsRows = data.items
    .map(
      (item) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee; color: #2D2A26;">${item.name}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; color: #2D2A26; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; color: #2D2A26; text-align: right;">${item.unitPrice.toFixed(2)}$</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; color: #2D2A26; text-align: right;">${item.amount.toFixed(2)}$</td>
      </tr>`
    )
    .join("");

  const mailOptions = {
    from: DISPLAY_FROM_NOREPLY,
    replyTo: ORDER_CONTACT_EMAIL,
    to: data.clientEmail,
    subject: isRefund
      ? `Crédit sur votre commande #${data.orderNumber} — Marius & Fanny`
      : `Modification de votre commande #${data.orderNumber} — Marius & Fanny`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F9F7F2; border-radius: 10px;">

        <div style="text-align: center; margin-bottom: 30px;">
          <img src="${LOGO_URL}" alt="Marius & Fanny" style="max-width: 120px; margin-bottom: 10px;" />
        </div>

        <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #337957; margin: 0; font-size: 22px;">
              Votre commande a été modifiée
            </h2>
          </div>

          <p style="color: #2D2A26; line-height: 1.6;">
            Bonjour <strong>${data.clientName}</strong>,
          </p>
          <p style="color: #2D2A26; line-height: 1.6;">
            Votre commande <strong>#${data.orderNumber}</strong> a été mise à jour. Voici le récapitulatif :
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background-color: #F9F7F2;">
                <th style="padding: 10px; text-align: left; color: #337957; font-size: 13px;">Produit</th>
                <th style="padding: 10px; text-align: center; color: #337957; font-size: 13px;">Qté</th>
                <th style="padding: 10px; text-align: right; color: #337957; font-size: 13px;">Prix unit.</th>
                <th style="padding: 10px; text-align: right; color: #337957; font-size: 13px;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
            </tbody>
          </table>

          <div style="background-color: #F9F7F2; padding: 16px; border-radius: 8px; margin: 20px 0;">
            <table style="width: 100%;">
              <tr>
                <td style="padding: 4px 0; color: #555;">Nouveau total :</td>
                <td style="padding: 4px 0; text-align: right; font-weight: bold; color: #2D2A26;">${data.newTotal.toFixed(2)}$</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #555;">Montant déjà payé :</td>
                <td style="padding: 4px 0; text-align: right; font-weight: bold; color: #337957;">${data.amountPaid.toFixed(2)}$</td>
              </tr>
              <tr>
                <td colspan="2" style="border-top: 2px solid #C5A065; padding-top: 8px; margin-top: 8px;"></td>
              </tr>
              <tr>
                <td style="padding: 4px 0; font-weight: bold; font-size: 16px; color: ${isRefund ? '#337957' : '#C5A065'};">
                  ${isRefund ? 'Crédit à rembourser :' : 'Balance à payer :'}
                </td>
                <td style="padding: 4px 0; text-align: right; font-weight: bold; font-size: 18px; color: ${isRefund ? '#337957' : '#C5A065'};">
                  ${absBalance.toFixed(2)}$
                </td>
              </tr>
            </table>
          </div>

          ${isRefund ? `
          <p style="color: #337957; font-weight: bold; text-align: center;">
            Un crédit de ${absBalance.toFixed(2)}$ vous sera remboursé.
          </p>
          ` : `
          <p style="color: #C5A065; font-weight: bold; text-align: center;">
            Un montant de ${absBalance.toFixed(2)}$ reste à payer pour finaliser votre commande.
          </p>
          `}

          <p style="color: #555; font-size: 13px; line-height: 1.5; margin-top: 16px;">
            Pour toute question, n'hésitez pas à nous contacter.
          </p>
        </div>

        <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
          <p>© ${new Date().getFullYear()} Marius &amp; Fanny. Tous droits réservés.</p>
        </div>
      </div>
    `,
  };

  await sendEmail(mailOptions);
  console.log(`✅ Email de balance envoyé à ${data.clientEmail} pour commande #${data.orderNumber}`);
}

/**
 * Send a quote (estimation) email with accept/refuse link
 */
export async function sendQuoteEmail(data: {
  to: string;
  clientName: string;
  quoteNumber: string;
  quoteId: string;
  items: Array<{ productName: string; quantity: number; unitPrice: number; amount: number }>;
  subtotal: number;
  taxAmount: number;
  deliveryFee: number;
  total: number;
  expiresAt: Date;
}): Promise<void> {
  const quoteUrl = `${FRONTEND_URL}/soumission/${data.quoteId}`;
  const expiryFormatted = new Date(data.expiresAt).toLocaleDateString("fr-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Montreal",
  });

  const itemsHtml = data.items
    .map(
      (item) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee; color: #2D2A26;">${item.productName}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; color: #2D2A26; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; color: #2D2A26; text-align: right;">${item.unitPrice.toFixed(2)}$</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; color: #2D2A26; text-align: right;">${item.amount.toFixed(2)}$</td>
      </tr>`,
    )
    .join("");

  const mailOptions = {
    from: DISPLAY_FROM_NOREPLY,
    replyTo: ORDER_CONTACT_EMAIL,
    to: data.to,
    subject: `Soumission ${data.quoteNumber} — Marius & Fanny`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F9F7F2; border-radius: 10px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <img src="${LOGO_URL}" alt="Marius & Fanny" style="max-width: 180px; height: auto;" />
        </div>

        <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 20px;">
            <div style="display: inline-block; background-color: #C5A065; color: white; padding: 10px 20px; border-radius: 20px; font-weight: bold;">
              📄 SOUMISSION
            </div>
          </div>

          <h2 style="color: #2D2A26; text-align: center; margin-bottom: 20px;">Bonjour ${data.clientName}</h2>

          <p style="color: #555; line-height: 1.6; text-align: center; margin-bottom: 30px;">
            Voici votre soumission personnalisée de <strong>Marius &amp; Fanny</strong>.<br>
            Veuillez l'accepter ou la refuser en cliquant sur le bouton ci-dessous.
          </p>

          <div style="background-color: #F9F7F2; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
            <p style="color: #999; margin: 0 0 5px 0; font-size: 12px;">Numéro de soumission</p>
            <p style="color: #C5A065; font-size: 24px; font-weight: bold; margin: 0; font-family: monospace;">${data.quoteNumber}</p>
            <p style="color: #999; margin: 10px 0 0 0; font-size: 12px;">Valable jusqu'au ${expiryFormatted}</p>
          </div>

          <h3 style="color: #2D2A26; border-bottom: 2px solid #C5A065; padding-bottom: 10px;">Détails</h3>

          <table style="width: 100%; margin-bottom: 20px; border-collapse: collapse;">
            <thead>
              <tr style="background-color: #F9F7F2;">
                <th style="padding: 10px; text-align: left; color: #2D2A26;">Produit</th>
                <th style="padding: 10px; text-align: center; color: #2D2A26;">Qté</th>
                <th style="padding: 10px; text-align: right; color: #2D2A26;">Prix</th>
                <th style="padding: 10px; text-align: right; color: #2D2A26;">Montant</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>

          <div style="text-align: right; margin-top: 20px;">
            <p style="color: #555; margin: 5px 0;"><span style="display:inline-block;width:150px;">Sous-total:</span> <strong>${data.subtotal.toFixed(2)}$</strong></p>
            <p style="color: #555; margin: 5px 0;"><span style="display:inline-block;width:150px;">TPS (5 %):</span> <strong>${(data.taxAmount * (0.05 / 0.14975)).toFixed(2)}$</strong></p>
            <p style="color: #555; margin: 5px 0;"><span style="display:inline-block;width:150px;">TVQ (9,975 %):</span> <strong>${(data.taxAmount * (0.09975 / 0.14975)).toFixed(2)}$</strong></p>
            <p style="color: #999; margin: 2px 0 10px 0; font-size: 11px;"><span style="display:inline-block;width:150px;">&nbsp;</span>TPS: 144652641RT001 &nbsp; TVQ: 1201862732TQ0001</p>
            ${data.deliveryFee > 0 ? `<p style="color: #555; margin: 5px 0;"><span style="display:inline-block;width:150px;">Livraison:</span> <strong>${data.deliveryFee.toFixed(2)}$</strong></p>` : ""}
            <p style="color: #C5A065; font-size: 20px; margin: 15px 0 0 0; padding-top: 10px; border-top: 2px solid #C5A065;">
              <span style="display:inline-block;width:150px;">Total estimé:</span>
              <strong>${data.total.toFixed(2)}$</strong>
            </p>
          </div>

          <div style="text-align: center; margin-top: 30px;">
            <a href="${quoteUrl}"
               style="display: inline-block; padding: 14px 40px; background-color: #337957; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
              Voir ma soumission
            </a>
          </div>

          <p style="color: #999; text-align: center; margin-top: 20px; font-size: 12px;">
            Cliquez sur le bouton pour voir le détail et <strong>accepter</strong> ou <strong>refuser</strong> la soumission.
          </p>

          ${buildCancellationPolicySection()}
        </div>

        <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
          <p>© 2026 Marius & Fanny. Tous droits réservés.</p>
        </div>
      </div>
    `,
  };

  await sendEmail(mailOptions);
  console.log(`✅ Soumission ${data.quoteNumber} envoyée à ${data.to}`);
}
