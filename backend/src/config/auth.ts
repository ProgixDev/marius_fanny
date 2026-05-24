import { betterAuth } from "better-auth";
import { emailOTP, bearer } from "better-auth/plugins";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import bcrypt from "bcryptjs";
import { connectMongoDB } from "./db.js";
import { sendVerificationCodeEmail } from "../utils/emailService.js";

// Initialize MongoDB connection for better-auth with error handling
let authInstance: ReturnType<typeof betterAuth> | null = null;

async function initializeAuth() {
  try {
    const { client, db } = await connectMongoDB();

    const isProduction = process.env.NODE_ENV === "production";

    // Session settings (seconds) — max 400 days (cookie limit)
    const sessionExpiresIn = 60 * 60 * 24 * 399; // 399 days
    const sessionUpdateAge = 60 * 60; // refresh every hour
    
    return betterAuth({
      baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
      basePath: "/api/auth",
      database: mongodbAdapter(db, {
        client, 
      }),
      session: {
        expiresIn: sessionExpiresIn,
        updateAge: sessionUpdateAge,
      },
      advanced: {
        useSecureCookies: isProduction,
        defaultCookieAttributes: {
          sameSite: isProduction ? "none" : "lax",
          secure: isProduction,
        },
      },
      user: {
        additionalFields: {
          role: {
            type: "string",
            required: false,
            defaultValue: "user", 
          },
        },
      },
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
        minPasswordLength: 5,
        password: {
          hash: async (password) => {
            return await bcrypt.hash(password, 10);
          },
          verify: async ({ hash, password }) => {
            return await bcrypt.compare(password, hash);
          },
        },
      },
      plugins: [
        emailOTP({
          overrideDefaultEmailVerification: true,
          sendVerificationOnSignUp: true,
          async sendVerificationOTP({ email, otp, type }) {
            try {
              console.log(`📧 [EMAIL-OTP] Sending ${type} OTP to ${email}: ${otp}`);
              // better-auth's emailOTP callback only gives us {email, otp,
              // type} — no user object — so the recipient name doesn't come
              // in for free. We look it up in the user collection so the
              // email says "Bonjour {first name}" instead of "Bonjour User".
              // First-name extraction = first token of the saved `name`.
              let displayName = "";
              try {
                const userDoc = await db.collection("user").findOne(
                  { email },
                  { projection: { name: 1 } },
                );
                const fullName = (userDoc?.name || "").trim();
                displayName = fullName.split(/\s+/)[0] || "";
              } catch (lookupErr) {
                console.warn(`⚠️ Could not look up name for ${email}:`, lookupErr);
              }
              await sendVerificationCodeEmail(email, displayName || "", undefined, otp);
            } catch (error) {
              console.error(`Failed to send ${type} OTP to ${email}:`, error);
              // Don't throw - user creation should not be blocked by email failures
            }
          },
        }),
        bearer(),
      ],
      trustedOrigins: [
        process.env.FRONTEND_URL || "http://localhost:5173",
        "https://marius-fanny-xi.vercel.app",
        "https://www.mariusetfanny.com",
        "https://mariusetfanny.com",
      ],
      secret:
        process.env.BETTER_AUTH_SECRET ||
        "your-secret-key-change-in-production",
      databaseHooks: {
        user: {
          create: {
            /**
             * Normalize role on every signup. Two reasons we touch this:
             *   1. additionalFields.defaultValue is supposed to set role
             *      automatically but the MongoDB adapter occasionally drops
             *      the field on insertion — leaving role undefined and the
             *      account invisible to the admin "Clients" list (which
             *      queries by role).
             *   2. The signup form historically posted role: "client", which
             *      isn't in the Mongoose User enum (user/pro/staff/admin/
             *      cuisinier/patissier/four/vendeur/customerService/
             *      deliveryDriver). Any later Mongoose save() — including the
             *      password reset flow — then crashes with a validation
             *      error. We coerce any non-staff string back to "user".
             */
            before: async (user) => {
              const ALLOWED_ROLES = new Set([
                "user", "pro", "staff", "admin", "customerService",
                "deliveryDriver", "cuisinier", "patissier", "four", "vendeur",
              ]);
              const submitted = (user as any).role;
              const safeRole = ALLOWED_ROLES.has(submitted) ? submitted : "user";
              return {
                data: {
                  ...user,
                  role: safeRole,
                },
              };
            },
            // NOTE: do NOT add an `after` hook that sends a verification
            // email here. The `emailOTP` plugin above already fires
            // `sendVerificationOTP` on signup with the real OTP that
            // better-auth will accept. A second email triggered from
            // `after` would generate its own (mock) random code, so the
            // client gets two emails with two different codes and tries
            // the wrong one. Keep the OTP flow as the single source.
          },
        },
      },
    });
  } catch (error) {
    console.error("❌ Failed to initialize auth:", error);
    // Re-throw so the failed init is NOT cached and the next request retries
    throw error;
  }
}

// Export a proxy that lazily initializes auth
export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
  get(target, prop) {
    if (!authInstance) {
      throw new Error("Auth not initialized. Call initializeAuth() first.");
    }
    return (authInstance as any)[prop];
  },
});

// Initialize and cache (only cache on success)
export async function getAuth() {
  if (!authInstance) {
    authInstance = await initializeAuth(); // throws on failure → not cached
  }
  return authInstance;
}
