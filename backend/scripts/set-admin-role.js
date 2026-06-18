import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI manquant dans backend/.env");
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────────────
// Utilisation :
//   node scripts/set-admin-role.js            → LISTE tous les comptes + leur
//                                                rôle RÉEL (lecture seule, sûr)
//   node scripts/set-admin-role.js <email>    → passe CE compte en rôle "admin"
//
// ⚠️ Le script agit sur la base pointée par MONGODB_URI dans backend/.env.
//    Pour corriger le compte utilisé par les tablettes (site en ligne), il
//    faut que MONGODB_URI pointe vers la base de PRODUCTION.
// ──────────────────────────────────────────────────────────────────────────
const targetEmail = process.argv[2];

const client = new MongoClient(MONGODB_URI);

async function run() {
  try {
    await client.connect();
    const db = client.db();
    const users = db.collection("user");

    if (!targetEmail) {
      // Lecture seule : montrer tous les comptes avec leur rôle.
      const all = await users
        .find({}, { projection: { email: 1, name: 1, role: 1 } })
        .sort({ role: 1 })
        .toArray();
      console.log(`\n📋 ${all.length} compte(s) trouvé(s) :\n`);
      console.log("  RÔLE\t\tEMAIL\t\t\tNOM");
      console.log("  ────\t\t─────\t\t\t───");
      for (const u of all) {
        console.log(`  ${u.role || "(aucun)"}\t${u.email}\t${u.name || ""}`);
      }
      console.log(
        `\n👉 Pour passer un compte en admin :  node scripts/set-admin-role.js <email>\n`,
      );
      return;
    }

    const before = await users.findOne({ email: targetEmail });
    if (!before) {
      console.error(`❌ Aucun compte avec l'email "${targetEmail}"`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `Compte trouvé : ${before.email} — rôle actuel : ${before.role || "(aucun)"}`,
    );

    if (before.role === "admin") {
      console.log("ℹ️ Ce compte est déjà admin. Rien à faire.");
      return;
    }

    const result = await users.updateOne(
      { email: targetEmail },
      { $set: { role: "admin", updatedAt: new Date() } },
    );
    console.log(
      `✅ Rôle mis à jour → "admin" (documents modifiés : ${result.modifiedCount}). ` +
        `Le compte devra peut-être se déconnecter/reconnecter pour rafraîchir sa session.`,
    );
  } catch (error) {
    console.error("❌ Erreur:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

run();
