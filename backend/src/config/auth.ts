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
              await sendVerificationCodeEmail(email, "User", undefined, otp);
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
             * Force role="user" on every signup. additionalFields.defaultValue
             * is supposed to do this but the MongoDB adapter sometimes drops
             * the field at insertion, leaving role undefined — which then
             * filters the account OUT of the admin "Clients" list (the query
             * uses { role: "user" } strict equality).
             */
            before: async (user) => {
              return {
                data: {
                  ...user,
                  role: (user as any).role || "user",
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
