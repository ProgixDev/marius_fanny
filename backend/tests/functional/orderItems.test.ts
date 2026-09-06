/**
 * BUG MAJEUR 3 — les options d'un article (« Pains : Pita ») et la quantité
 * doivent survivre à une modification, puis à l'emballage.
 *
 * BUG MINEUR — l'historique ne doit pas consigner « Produits modifiés » quand
 * rien n'a bougé.
 *
 * Test FONCTIONNEL : rejoue la séquence exacte qui effaçait les données —
 * modification, puis case « emballé » cochée — sur le vrai contrôleur.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { resetSquare, resetMail } from "../setup";
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

async function commandeAvecOptions() {
  const Order = (await import("../../src/models/Order.js")).default;
  return Order.create({
    userId: "69b40515f8866a250a6d4599",
    clientInfo,
    pickupDate: new Date(Date.now() + 5 * 864e5),
    pickupLocation: "Laval",
    deliveryType: "pickup",
    items: [orderItem({ quantity: 2, amount: 41.9, selectedOptions: { Pains: "Baguette" } })],
    subtotal: 41.9,
    taxAmount: 6.27,
    tpsAmount: 2.1,
    tvqAmount: 4.18,
    deliveryFee: 0,
    total: 48.17,
    depositAmount: 48.17,
    paymentType: "full",
    paymentStatus: "unpaid",
    status: "pending",
    orderNumber: `MF-TEST-${Math.floor(Math.random() * 1e6)}`,
  });
}

async function patch(order: any, body: any) {
  const { updateOrder } = await import("../../src/controllers/order.controller.js");
  const res = fakeRes();
  await updateOrder(fakeReq(body, { id: String(order._id) }), res);
  return res;
}

describe("Options et quantité d'un article", () => {
  test("cocher « emballé » ne détruit pas les options", async () => {
    const order = await commandeAvecOptions();
    // Exactement ce que l'écran renvoie quand on coche la case.
    await patch(order, {
      items: [
        {
          productId: 101,
          productName: "Boîte à lunch dinde et pesto",
          quantity: 2,
          unitPrice: 20.95,
          amount: 41.9,
          selectedOptions: { Pains: "Baguette" },
          productionStatus: "ready",
        },
      ],
    });

    const Order = (await import("../../src/models/Order.js")).default;
    const apres = await Order.findById(order._id);
    expect(apres!.items[0].selectedOptions).toEqual({ Pains: "Baguette" } as any);
    expect(apres!.items[0].quantity).toBe(2);
  });

  test("un emballage sans changement n'ajoute AUCUNE ligne d'historique", async () => {
    const order = await commandeAvecOptions();
    const avant = order.changeHistory.length;
    await patch(order, {
      items: [
        {
          productId: 101,
          productName: "Boîte à lunch dinde et pesto",
          quantity: 2,
          unitPrice: 20.95,
          amount: 41.9,
          selectedOptions: { Pains: "Baguette" },
          productionStatus: "ready",
        },
      ],
    });

    const Order = (await import("../../src/models/Order.js")).default;
    const apres = await Order.findById(order._id);
    const lignesArticles = apres!.changeHistory.filter((h: any) => h.field === "items");
    expect(lignesArticles).toHaveLength(0);
    expect(apres!.changeHistory.length).toBe(avant);
  });

  test("une vraie modification de quantité EST consignée", async () => {
    const order = await commandeAvecOptions();
    await patch(order, {
      items: [
        {
          productId: 101,
          productName: "Boîte à lunch dinde et pesto",
          quantity: 5,
          unitPrice: 20.95,
          amount: 104.75,
          selectedOptions: { Pains: "Baguette" },
        },
      ],
    });

    const Order = (await import("../../src/models/Order.js")).default;
    const apres = await Order.findById(order._id);
    expect(apres!.changeHistory.filter((h: any) => h.field === "items")).toHaveLength(1);
    expect(apres!.items[0].quantity).toBe(5);
    expect(apres!.items[0].selectedOptions).toEqual({ Pains: "Baguette" } as any);
  });

  test("changer l'option est consigné et enregistré", async () => {
    const order = await commandeAvecOptions();
    await patch(order, {
      items: [
        {
          productId: 101,
          productName: "Boîte à lunch dinde et pesto",
          quantity: 2,
          unitPrice: 20.95,
          amount: 41.9,
          selectedOptions: { Pains: "Pita" },
        },
      ],
    });

    const Order = (await import("../../src/models/Order.js")).default;
    const apres = await Order.findById(order._id);
    expect(apres!.items[0].selectedOptions).toEqual({ Pains: "Pita" } as any);
    expect(apres!.changeHistory.filter((h: any) => h.field === "items")).toHaveLength(1);
  });

  test("la liste des commandes ne transporte plus changeHistory", async () => {
    await commandeAvecOptions();
    const { getOrders } = await import("../../src/controllers/order.controller.js");
    const res = fakeRes();
    await getOrders(fakeReq({}, {}, { page: 1, limit: 20 }) as any, res as any);

    expect(res.body.success).toBe(true);
    const items = res.body.data.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].changeHistory).toBeUndefined();
  });
});

describe("Client gouvernemental", () => {
  test("impossible de le marquer payé", async () => {
    const Order = (await import("../../src/models/Order.js")).default;
    const order = await commandeAvecOptions();
    await Order.updateOne({ _id: order._id }, { $set: { billingKind: "gouvernement" } });
    const frais = await Order.findById(order._id);

    const res = await patch(frais, { depositPaid: true, balancePaid: true });
    expect(res.statusCode).toBe(400);

    const apres = await Order.findById(order._id);
    expect(apres!.paymentStatus).toBe("unpaid");
    expect(apres!.depositPaid).toBe(false);
  });
});
