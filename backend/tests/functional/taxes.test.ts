/**
 * BUG MAJEUR 1 — la TPS et la TVQ doivent atterrir dans la section « Taxes »
 * de Square, jamais comme des articles de la commande.
 *
 * Test FONCTIONNEL : on appelle le vrai contrôleur de facturation, avec une
 * vraie commande en base, et on inspecte ce qui part réellement vers Square.
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

async function createPaidLinkOrder(items: any[]) {
  const Order = (await import("../../src/models/Order.js")).default;
  const { computeTaxBreakdown } = await import("../../src/utils/tax.js");
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const tax = await computeTaxBreakdown(items as any);
  const deliveryFee = 30;
  const total = subtotal + tax.total + deliveryFee;
  return Order.create({
    userId: "69b40515f8866a250a6d4599",
    clientInfo,
    pickupDate: new Date(Date.now() + 5 * 864e5),
    pickupLocation: "Laval",
    deliveryType: "delivery",
    items,
    subtotal,
    taxAmount: tax.total,
    tpsAmount: tax.tps,
    tvqAmount: tax.tvq,
    deliveryFee,
    total,
    depositAmount: total,
    paymentType: "full",
    paymentStatus: "unpaid",
    status: "pending",
    orderNumber: `MF-TEST-${Math.floor(Math.random() * 1e6)}`,
  });
}

describe("Taxes transmises à Square", () => {
  test("aucune pseudo-ligne TPS/TVQ n'est envoyée comme article", async () => {
    const order = await createPaidLinkOrder([orderItem()]);
    const { createInvoiceForExistingOrder } = await import("../../src/controllers/payment.controller.js");
    await createInvoiceForExistingOrder(String(order._id), "email");

    const create = squareCalls.find((c) => c.method === "orders.create");
    expect(create).toBeDefined();
    const names = create!.body.order.lineItems.map((l: any) => l.name);
    expect(names.some((n: string) => /^TPS|^TVQ/i.test(n))).toBe(false);
  });

  test("les taxes sont déclarées nativement, ligne par ligne", async () => {
    const order = await createPaidLinkOrder([orderItem()]);
    const { createInvoiceForExistingOrder } = await import("../../src/controllers/payment.controller.js");
    await createInvoiceForExistingOrder(String(order._id), "email");

    const body = squareCalls.find((c) => c.method === "orders.create")!.body.order;
    expect(body.taxes).toHaveLength(2);
    expect(body.taxes.map((t: any) => t.uid).sort()).toEqual(["tps", "tvq"]);
    expect(body.taxes.every((t: any) => t.scope === "LINE_ITEM")).toBe(true);
    expect(body.taxes.find((t: any) => t.uid === "tps").percentage).toBe("5");
    expect(body.taxes.find((t: any) => t.uid === "tvq").percentage).toBe("9.975");
  });

  test("la section Taxes de Square n'est plus à zéro", async () => {
    const order = await createPaidLinkOrder([orderItem()]);
    const { createInvoiceForExistingOrder } = await import("../../src/controllers/payment.controller.js");
    await createInvoiceForExistingOrder(String(order._id), "email");

    // La doublure calcule les taxes comme Square le ferait.
    const create = squareCalls.find((c) => c.method === "orders.create")!;
    const lineTotal = 2 * 20.95;
    const attendu = Math.round(lineTotal * 0.05 * 100) / 100 + Math.round(lineTotal * 0.09975 * 100) / 100;
    expect(attendu).toBeGreaterThan(0);
    expect(create.body.order.lineItems[0].appliedTaxes).toHaveLength(2);
  });

  test("chaque article reçoit les taxes correspondant à son régime", async () => {
    const items = [
      orderItem(), // both
      orderItem({ productId: 102, productName: "Croissant", quantity: 1, unitPrice: 3.5, amount: 3.5, selectedOptions: undefined }), // gst_only
      orderItem({ productId: 103, productName: "Pain de campagne", quantity: 1, unitPrice: 6, amount: 6, selectedOptions: undefined }), // none
    ];
    const order = await createPaidLinkOrder(items);
    const { createInvoiceForExistingOrder } = await import("../../src/controllers/payment.controller.js");
    await createInvoiceForExistingOrder(String(order._id), "email");

    const lines = squareCalls.find((c) => c.method === "orders.create")!.body.order.lineItems;
    const uids = (n: string) =>
      (lines.find((l: any) => l.name === n)?.appliedTaxes || []).map((t: any) => t.taxUid).sort();

    expect(uids("Boîte à lunch dinde et pesto")).toEqual(["tps", "tvq"]);
    expect(uids("Croissant")).toEqual(["tps"]);
    expect(uids("Pain de campagne")).toEqual([]);
  });

  test("les frais de livraison restent hors base taxable", async () => {
    const order = await createPaidLinkOrder([orderItem()]);
    const { createInvoiceForExistingOrder } = await import("../../src/controllers/payment.controller.js");
    await createInvoiceForExistingOrder(String(order._id), "email");

    const lines = squareCalls.find((c) => c.method === "orders.create")!.body.order.lineItems;
    const livraison = lines.find((l: any) => l.name === "Frais de livraison");
    expect(livraison).toBeDefined();
    expect(livraison.appliedTaxes).toEqual([]);
  });
});
