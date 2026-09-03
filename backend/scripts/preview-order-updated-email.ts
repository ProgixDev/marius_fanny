/**
 * Aperçu RÉEL du courriel « commande modifiée », sans Gmail, sans compte SMTP
 * et sans écrire à un vrai client.
 *
 * Démarre un petit serveur SMTP local qui capture le message au lieu de le
 * livrer, puis pointe la configuration courriel dessus. Le HTML récupéré est
 * EXACTEMENT celui qui partirait au client : on l'écrit sur disque et on
 * vérifie que le nouveau lien de paiement s'y trouve.
 *
 * Usage (depuis backend/) :
 *   bun scripts/preview-order-updated-email.ts [NUMERO_DE_COMMANDE]
 */
import dns from "node:dns";
dns.setServers(["1.1.1.1", "8.8.8.8"]);

import dotenv from "dotenv";
dotenv.config();

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

interface CapturedMail {
  raw: string;
}

/** Serveur SMTP minimal : accepte tout, ne livre rien, garde le message. */
const startSmtpSink = (captured: CapturedMail[]): Promise<number> =>
  new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let inData = false;
      let buffer = "";
      let message = "";

      socket.write("220 localhost SMTP de test\r\n");

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");

        if (inData) {
          message += buffer;
          buffer = "";
          const end = message.indexOf("\r\n.\r\n");
          if (end !== -1) {
            captured.push({ raw: message.slice(0, end) });
            message = "";
            inData = false;
            socket.write("250 OK\r\n");
          }
          return;
        }

        let idx: number;
        while ((idx = buffer.indexOf("\r\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const cmd = line.split(" ")[0].toUpperCase();

          if (cmd === "EHLO" || cmd === "HELO") {
            // Pas de STARTTLS annoncé : nodemailer reste en clair, en local.
            socket.write("250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n");
          } else if (cmd === "AUTH") {
            socket.write(line.toUpperCase().includes("LOGIN") ? "334 VXNlcm5hbWU6\r\n" : "235 OK\r\n");
          } else if (cmd === "QUIT") {
            socket.write("221 Bye\r\n");
            socket.end();
          } else if (cmd === "DATA") {
            inData = true;
            message = buffer;
            buffer = "";
            socket.write("354 Envoyez les données\r\n");
          } else {
            // MAIL FROM, RCPT TO, RSET, réponses d'authentification…
            socket.write("235 OK\r\n");
          }
        }
      });

      socket.on("error", () => socket.destroy());
    });

    server.listen(0, "127.0.0.1", () => {
      server.unref();
      resolve((server.address() as net.AddressInfo).port);
    });
  });

/** Extrait et décode la partie HTML d'un message MIME. */
const extractHtml = (raw: string): string => {
  const parts = raw.split(/\r\n--/);
  const htmlPart =
    parts.find((p) => /content-type:\s*text\/html/i.test(p)) ??
    (/content-type:\s*text\/html/i.test(raw) ? raw : "");
  if (!htmlPart) return "";

  const sep = htmlPart.indexOf("\r\n\r\n");
  const headers = htmlPart.slice(0, sep);
  let body = htmlPart.slice(sep + 4);

  if (/content-transfer-encoding:\s*base64/i.test(headers)) {
    return Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
  }
  if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) {
    body = body.replace(/=\r\n/g, "");
    return body.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      Buffer.from(hex, "hex").toString("binary"),
    );
  }
  return body;
};

const run = async () => {
  const orderNumber = process.argv[2] || "MF-20260831-0458";

  const captured: CapturedMail[] = [];
  const port = await startSmtpSink(captured);

  process.env.EMAIL_HOST = "127.0.0.1";
  process.env.EMAIL_PORT = String(port);
  process.env.EMAIL_USER = "test@local";
  process.env.EMAIL_PASSWORD = "test";
  // Resend prendrait le dessus : on le neutralise pour forcer le SMTP local.
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;

  // Import APRÈS la configuration : le transporteur est bâti à l'import.
  const { sendOrderUpdatedEmail } = await import("../src/utils/mail.js");
  const { default: Order } = await import("../src/models/Order.js");
  const { orderServiceDate } = await import("../src/utils/dates.js");

  await mongoose.connect(process.env.MONGODB_URI!, {
    family: 4,
    serverSelectionTimeoutMS: 15000,
  } as any);

  const order: any = await Order.findOne({ orderNumber });
  if (!order) throw new Error(`Commande ${orderNumber} introuvable`);

  console.log(`Commande : ${order.orderNumber} — total ${order.total} $`);
  console.log(`SMTP de test sur 127.0.0.1:${port} — aucun client réel n'est contacté.\n`);

  const payload = {
    email: "client@exemple.test",
    name: `${order.clientInfo.firstName} ${order.clientInfo.lastName}`.trim(),
    orderNumber: order.orderNumber,
    items: (order.items || []).map((it: any) => ({
      productName: it.productName,
      quantity: it.quantity,
      amount: it.amount ?? (it.unitPrice || 0) * (it.quantity || 1),
    })),
    changeLines: [
      "Quantité modifiée : Salade repas césar (5 → 4)",
      "Article retiré : Boîte à lunch saumon et olives noires",
    ],
    subtotal: order.subtotal,
    taxAmount: order.taxAmount,
    taxBreakdown: { tps: order.tpsAmount, tvq: order.tvqAmount },
    deliveryFee: order.deliveryFee,
    total: order.total,
    amountPaid: 0, // commande non payée → bloc « reste à payer »
    serviceDate: orderServiceDate(order),
    timeSlot: order.deliveryTimeSlot || undefined,
    deliveryType: order.deliveryType,
    orderId: order._id.toString(),
  };

  // 1) AVEC nouveau lien — le comportement corrigé.
  await sendOrderUpdatedEmail({
    ...payload,
    invoiceUrl: "https://squareup.com/pay-invoice/EXEMPLE-NOUVEAU-LIEN",
  });
  // 2) SANS lien — pour comparaison avec l'ancien comportement.
  await sendOrderUpdatedEmail(payload);

  await mongoose.disconnect();

  if (captured.length < 2) {
    throw new Error(`Seulement ${captured.length} courriel(s) capturé(s).`);
  }

  const htmlWith = extractHtml(captured[0].raw);
  const htmlWithout = extractHtml(captured[1].raw);

  const outDir = path.join(process.cwd(), "exports");
  fs.mkdirSync(outDir, { recursive: true });
  const fileWith = path.join(outDir, "courriel-modifie-AVEC-lien.html");
  const fileWithout = path.join(outDir, "courriel-modifie-SANS-lien.html");
  fs.writeFileSync(fileWith, htmlWith, "utf8");
  fs.writeFileSync(fileWithout, htmlWithout, "utf8");

  const checks: Array<[string, boolean]> = [
    ["Le nouveau lien de paiement est présent", htmlWith.includes("EXEMPLE-NOUVEAU-LIEN")],
    ["Le bouton « Payer <montant> $ » est rendu", /Payer\s+[\d\s.,]+\$/.test(htmlWith)],
    ["Le nouveau total apparaît", htmlWith.includes(order.total.toFixed(2))],
    [
      "Sans lien : on retombe sur l'ancien texte",
      htmlWithout.includes("lien de paiement que nous pouvons vous envoyer"),
    ],
    ["Sans lien : aucun lien parasite", !htmlWithout.includes("EXEMPLE-NOUVEAU-LIEN")],
  ];

  console.log("=== Contrôles sur le HTML réellement expédié ===");
  let failed = 0;
  for (const [label, ok] of checks) {
    if (!ok) failed++;
    console.log(`${ok ? "✅" : "❌"} ${label}`);
  }

  console.log(`\nOuvre ces fichiers dans un navigateur :`);
  console.log(`  ${fileWith}`);
  console.log(`  ${fileWithout}`);

  if (failed > 0) process.exit(1);
};

run().catch((e) => {
  console.error("ERREUR:", e?.message || e);
  process.exit(1);
});
