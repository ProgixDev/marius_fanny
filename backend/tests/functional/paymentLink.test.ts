/**
 * BUG MAJEUR 2 — quand une commande change de montant, le client doit recevoir
 * un lien de paiement au NOUVEAU montant, et « Renvoyer la facture » ne doit
 * jamais réexpédier un prix périmé.
 *
 * Test FONCTIONNEL : rejoue la commande 458 (Julien Kovacevic) sur le vrai
 * contrôleur `updateOrder`, avec une vraie commande en base, et observe ce qui
 * part vers Square et vers le client.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { squareCalls, resetSquare, mailCalls, resetMail } from "../setup";
import {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
  seedProducts,
  fakeReq,
  fakeRes,
  orderItem,
  clientInfo,
} from "../helpers";

beforeAll(async () => {
  await connectTestDb();
});
afterAll(async () => {
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearTestDb();
  await seedProducts();
  resetSquare();
  resetMail();
});

/** Commande avec un lien de paiement Square déjà émis, non payée. */
async function orderWithOpenLink(over: any = {}) {
  const Order = (await import("../../src/models/Order.js")).default;
  const items = [orderItem({ quantity: 5, amount: 104.75 })];
  const subtotal = 104.75;
  return Order.create({
    userId: "69b40515f8866a250a6d4599",
    clientInfo,
    pickupDate: new Date(Date.now() + 5 * 864e5),
    pickupLocation: "Laval",
    deliveryType: "delivery",
    items,
    subtotal,
    taxAmount: 15.69,
    tpsAmount: 5.24,
    tvqAmount: 10.45,
    deliveryFee: 30,
    total: 150.44,
    depositAmount: 150.44,
    paymentType: "full",
    paymentStatus: "unpaid",
    paymentLinkChannel: "email",
    squareInvoiceId: "inv_ANCIENNE",
    status: "pending",
    orderNumber: `MF-TEST-${Math.floor(Math.random() * 1e6)}`,
    ...over,
  });
}

/** Applique une modification d'articles via le VRAI contrôleur. */
async function modifierArticles(order: any, items: any[]) {
  const { updateOrder } = await import("../../src/controllers/order.controller.js");
  const req = fakeReq({ items }, { id: String(order._id) });
  const res = fakeRes();
  await updateOrder(req, res);
  return res;
}

describe("Lien de paiement après modification (commande 458)", () => {
  test("baisse du montant : l'ancienne facture est annulée et une nouvelle émise", async () => {
    const order = await orderWithOpenLink();
    await modifierArticles(order, [orderItem({ quantity: 4, amount: 83.8 })]);

    const cancel = squareCalls.find((c) => c.method === "invoices.cancel");
    const create = squareCalls.find((c) => c.method === "invoices.create");
    expect(cancel).toBeDefined();
    expect(cancel!.body.invoiceId).toBe("inv_ANCIENNE");
    expect(create).toBeDefined();
    // L'annulation vient AVANT la création : jamais deux liens actifs.
    expect(squareCalls.indexOf(cancel!)).toBeLessThan(squareCalls.indexOf(create!));
  });

  test("le client reçoit le courriel « commande modifiée » AVEC le nouveau lien", async () => {
    const order = await orderWithOpenLink();
    await modifierArticles(order, [orderItem({ quantity: 4, amount: 83.8 })]);

    const mail = mailCalls.find((m) => m.fn === "sendOrderUpdatedEmail");
    expect(mail).toBeDefined();
    expect(mail!.args[0].invoiceUrl).toContain("https://square.test/pay/");
  });

  test("un seul courriel part : pas de doublon avec la facture", async () => {
    const order = await orderWithOpenLink();
    await modifierArticles(order, [orderItem({ quantity: 4, amount: 83.8 })]);

    expect(mailCalls.filter((m) => m.fn === "sendOrderUpdatedEmail")).toHaveLength(1);
    expect(mailCalls.filter((m) => m.fn === "sendInvoiceOrderConfirmation")).toHaveLength(0);
  });

  test("la commande porte le NOUVEL identifiant de facture", async () => {
    const order = await orderWithOpenLink();
    await modifierArticles(order, [orderItem({ quantity: 4, amount: 83.8 })]);

    const Order = (await import("../../src/models/Order.js")).default;
    const apres = await Order.findById(order._id);
    expect(apres!.squareInvoiceId).toBeDefined();
    expect(apres!.squareInvoiceId).not.toBe("inv_ANCIENNE");
  });

  test("montant inchangé : aucune facture recréée (pas de doublon)", async () => {
    const order = await orderWithOpenLink();
    await modifierArticles(order, [orderItem({ quantity: 5, amount: 104.75 })]);

    expect(squareCalls.filter((c) => c.method === "invoices.create")).toHaveLength(0);
    expect(squareCalls.filter((c) => c.method === "invoices.cancel")).toHaveLength(0);
  });

  test("client gouvernemental : jamais de lien de paiement", async () => {
    const order = await orderWithOpenLink({ billingKind: "gouvernement", billingOrganization: "Ville de Laval" });
    await modifierArticles(order, [orderItem({ quantity: 4, amount: 83.8 })]);

    expect(squareCalls.filter((c) => c.method === "invoices.create")).toHaveLength(0);
  });
});
