/**
 * Utilitaires communs aux tests fonctionnels : connexion à la base de TEST,
 * remise à zéro entre les cas, jeu de produits, et fausses requêtes Express.
 */
import mongoose from "mongoose";
import dns from "node:dns";

dns.setServers(["1.1.1.1", "8.8.8.8"]);

export async function connectTestDb() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.MONGODB_URI!, {
    family: 4,
    serverSelectionTimeoutMS: 20000,
  } as any);
  const name = mongoose.connection.name;
  // Garde-fou : on refuse catégoriquement de tourner sur la base du site.
  if (!/test/i.test(name)) {
    throw new Error(`Refus de tester sur la base « ${name} » : nom sans « test ».`);
  }
}

export async function clearTestDb() {
  const db = mongoose.connection.db;
  if (!db) return;
  for (const c of await db.collections()) await c.deleteMany({});
}

export async function disconnectTestDb() {
  await mongoose.connection.close();
}

/** Réponse Express factice : capte le code et le corps. */
export function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    send(payload: any) {
      this.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
  };
  return res;
}

/** Requête Express factice, authentifiée en admin par défaut. */
export function fakeReq(body: any = {}, params: any = {}, query: any = {}) {
  return {
    body,
    params,
    query,
    user: { id: "69b40515f8866a250a6d4599", role: "admin", email: "admin@test.local" },
    headers: {},
  } as any;
}

/** Produits de référence, avec des régimes de taxe différents. */
export async function seedProducts() {
  const { Product } = await import("../src/models/Product.js");
  await Product.create([
    {
      id: 101,
      name: "Boîte à lunch dinde et pesto",
      price: 20.95,
      category: "Boîtes à lunch",
      available: true,
      taxMode: "both",
      hasTaxes: true,
      productionType: "cuisinier",
      targetAudience: "clients",
      customOptions: [{ name: "Pains", type: "choice", choices: ["Pita", "Baguette"] }],
    },
    {
      id: 102,
      name: "Croissant",
      price: 3.5,
      category: "Viennoiseries",
      available: true,
      taxMode: "gst_only",
      hasTaxes: true,
      productionType: "patisserie",
      targetAudience: "clients",
      preparationTimeHours: 24,
    },
    {
      id: 103,
      name: "Pain de campagne",
      price: 6.0,
      category: "Pains",
      available: true,
      taxMode: "none",
      hasTaxes: false,
      productionType: "four",
      targetAudience: "clients",
      preparationTimeHours: 48,
    },
  ]);
}

/** Article de commande prêt à l'emploi. */
export function orderItem(over: any = {}) {
  return {
    productId: 101,
    productName: "Boîte à lunch dinde et pesto",
    quantity: 2,
    unitPrice: 20.95,
    amount: 41.9,
    selectedOptions: { Pains: "Pita" },
    ...over,
  };
}

/** Client type. */
export const clientInfo = {
  firstName: "Julien",
  lastName: "Kovacevic",
  email: "julien.test@exemple.test",
  phone: "4501234567",
};
