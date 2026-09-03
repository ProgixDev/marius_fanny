import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try both possible locations for .env (src/../.env and src/../../backend/.env)
const envPath = path.join(__dirname, "..", ".env");
const result = dotenv.config({ path: envPath });
if (result.error || !process.env.MONGODB_URI) {
  dotenv.config({ path: path.join(process.cwd(), ".env") });
}

import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { toNodeHandler } from "better-auth/node";
import { getAuth } from "./config/auth.js";
import { uploadsDir } from "./config/paths.js";
import apiRoutes from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { sanitizeBody } from "./middleware/validation.js";
import { validateSquareConfig } from "./config/square.js";

// DNS configuration for MongoDB Atlas SRV record resolution
import dns from "node:dns";

// Use Cloudflare + Google DNS (very reliable for SRV records)
dns.setServers(["1.1.1.1", "8.8.8.8"]);

// Optional: also do promises version if your code uses dns.promises somewhere
import dnsPromises from "node:dns/promises";
dnsPromises.setServers(["1.1.1.1", "8.8.8.8"]);

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// --- AJOUTE CETTE LIGNE ICI (AVANT LA CONNEXION) ---
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not set");
}

// 1. CONNEXION MONGOOSE
mongoose.set("strictQuery", true);

// Add DNS resolution options for Bun compatibility
const mongooseOptions = {
  family: 4, // Use IPv4, skip trying IPv6
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

mongoose
  .connect(MONGODB_URI, mongooseOptions)
  .then(async () => {
    console.log("✅ MONGOOSE CONNECTÉ");
    validateSquareConfig();

    // Numeros de taxes affiches sur les factures : charges depuis les reglages,
    // avec repli sur les valeurs par defaut si la lecture echoue.
    try {
      const { Settings } = await import("./models/Settings.js");
      const { setTaxNumbers } = await import("./config/taxNumbers.js");
      const s = await Settings.findOne().lean();
      if (s) setTaxNumbers({ tps: (s as any).tpsNumber, tvq: (s as any).tvqNumber });
    } catch (e: any) {
      console.warn("⚠️ Numeros de taxes non charges, valeurs par defaut utilisees:", e?.message);
    }

    // Initialize auth after database connection
    try {
      const auth = await getAuth();
      authHandler = toNodeHandler(auth);
      console.log("✅ Better Auth initialized and ready");
    } catch (error) {
      console.error("❌ Failed to initialize Better Auth:", error);
      console.error("⚠️  Auth endpoints will be unavailable");
    }
  })
  .catch((err) => {
    console.error("❌ ERREUR CONNEXION MONGOOSE:", err);
    console.log("⚠️  Server will continue without database connection");
    console.log("⚠️  Better Auth will not be available");
  });

// 2. MIDDLEWARES

// Global request logger - logs ALL incoming requests
// Removed request logger for production cleanliness

// CORS configuration - accepte localhost sur n'importe quel port en développement
const allowedOrigins = [
  FRONTEND_URL,
  "https://marius-fanny-xi.vercel.app",
  "https://www.mariusetfanny.com",
  "https://mariusetfanny.com",
];
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Allow requests from localhost (any port) in development
    if (process.env.NODE_ENV === "development" && origin?.includes("localhost")) {
      callback(null, true);
    }
    // Allow from known origins
    else if (origin && allowedOrigins.includes(origin)) {
      callback(null, true);
    }
    // Allow requests with no origin (like mobile apps or curl requests)
    else if (!origin) {
      callback(null, true);
    }
    // Deny others
    else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  // Expose set-auth-token so the browser JS can READ the bearer token from the
  // login response and store it. Without this, the token is never saved and the
  // app falls back to the cross-site auth cookie — which Edge/Safari block
  // (tracking prevention), causing empty lists / "not authorized".
  exposedHeaders: ["set-auth-token"],
  credentials: true,
};

app.use(cors(corsOptions));

// 3. BETTER AUTH (REGISTER BEFORE JSON BODY PARSING)
// Initialize auth handler once
let authHandler: any = null;
let authInitPromise: Promise<void> | null = null;

// Function to wait for auth initialization
async function waitForAuth() {
  if (authHandler) return;
  
  if (!authInitPromise) {
    authInitPromise = new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (authHandler) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 10000);
    });
  }
  
  return authInitPromise;
}

app.all(/^\/api\/auth\/.*/, async (req, res) => {
  try {
    // Wait for auth handler to be initialized
    if (!authHandler) {
      await waitForAuth();
    }
    
    if (!authHandler) {
      return res.status(503).json({ error: "Auth service not ready" });
    }
    return authHandler(req, res);
  } catch (error) {
    console.error("❌ [AUTH] Better Auth error:", error);
    res.status(500).json({ success: false, error: "Auth service error" });
  }
});

app.use(express.json());
app.use(sanitizeBody);

// Serve uploaded files
console.log("📁 Serving static files from:", uploadsDir);
app.use("/uploads", express.static(uploadsDir));

// 4. TES ROUTES PERSONNALISÉES (EN PREMIER)
// On monte apiRoutes sur /api.
// Il va intercepter /api/auth/forgot_password avant Better Auth.
app.use("/api", apiRoutes);

app.get("/", (req, res) => {
  res.json({ message: "Server is running" });
});

// 5. GESTION DES ERREURS
app.use(notFoundHandler);
app.use(errorHandler);

// Export for programmatic use
export default app;

// Start the long-running HTTP server UNLESS we're on Vercel (serverless, where
// the platform imports `app` and handles requests via api/index.ts — no listen).
// On a classic host (Render, Railway, local), we must listen, including in
// production — otherwise the host detects "no open ports" and the deploy fails.
const isVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true" || !!process.env.NOW_REGION;

if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });

  // Filet de sécurité : re-synchronise les commandes payées dans Square mais
  // restées "non payées" dans le site (au cas où un webhook se perd). Au
  // démarrage (après 1 min) puis toutes les 30 min.
  import("./controllers/payment.controller.js")
    .then(({ reconcileUnpaidOrders }) => {
      const run = () =>
        reconcileUnpaidOrders().catch((e) =>
          console.error("[RECONCILE] erreur:", e?.message || e),
        );
      setTimeout(run, 60 * 1000);
      setInterval(run, 30 * 60 * 1000);
    })
    .catch((e) => console.error("[RECONCILE] init échouée:", e?.message || e));

  // Surveillance de l'envoi de courriels : au démarrage (après ~2,5 min, donc à
  // chaque déploiement) puis toutes les 24 h. Alerte par courriel en cas de
  // panne d'envoi (adresse d'expédition cassée, SMTP KO, non-livraison…).
  import("./utils/emailHealth.js")
    .then(({ runEmailHealthCheck }) => {
      const run = () =>
        runEmailHealthCheck().catch((e) =>
          console.error("[SANTÉ COURRIEL] erreur:", e?.message || e),
        );
      setTimeout(run, 150 * 1000);
      setInterval(run, 24 * 60 * 60 * 1000);
    })
    .catch((e) => console.error("[SANTÉ COURRIEL] init échouée:", e?.message || e));
}
