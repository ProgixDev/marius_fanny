/**
 * Préparation des tests FONCTIONNELS.
 *
 * Objectif : exercer le vrai code (validation Zod → contrôleur → MongoDB) sans
 * jamais toucher à la production. Deux garde-fous :
 *  - la base est une base de TEST dédiée, jamais celle du site ;
 *  - Square, les courriels, les SMS et le PDF sont remplacés par des doublures
 *    qui enregistrent les appels au lieu de les exécuter.
 */
import { mock } from "bun:test";
import dotenv from "dotenv";

dotenv.config();

// --- Base de test : on remplace le nom de la base dans l'URI --------------
const rawUri = process.env.MONGODB_URI || "";
if (!rawUri) throw new Error("MONGODB_URI absent : impossible de préparer les tests.");
if (/\/MariusFanny(\?|$)/.test(rawUri) === false && !rawUri.includes("_test")) {
  // On accepte quand même, mais on force un nom de base distinct ci-dessous.
}
export const TEST_DB = "MariusFanny_tests_auto";
process.env.MONGODB_URI = rawUri.replace(/\/([^/?]+)(\?|$)/, `/${TEST_DB}$2`);

// Empêche tout envoi réel même si une doublure était oubliée.
process.env.SMS_DRY_RUN = "true";
process.env.SQUARE_ENVIRONMENT = "sandbox";

// --- Doublure Square : enregistre les appels ------------------------------
export interface SquareCall {
  method: string;
  body: any;
}
export const squareCalls: SquareCall[] = [];
export const resetSquare = () => {
  squareCalls.length = 0;
};

let invoiceSeq = 0;

const squareClient = {
  orders: {
    create: async (body: any) => {
      squareCalls.push({ method: "orders.create", body });
      const order = body.order;
      // Reproduit le calcul de Square : taxes appliquées ligne par ligne.
      const rate: Record<string, number> = {};
      for (const t of order.taxes || []) rate[t.uid] = Number(t.percentage) / 100;
      let sub = 0;
      let tax = 0;
      const perTax: Record<string, number> = {};
      for (const li of order.lineItems || []) {
        const line = Number(li.quantity) * (Number(li.basePriceMoney.amount) / 100);
        sub += line;
        for (const at of li.appliedTaxes || []) {
          const t = Math.round(line * rate[at.taxUid] * 100) / 100;
          tax += t;
          perTax[at.taxUid] = (perTax[at.taxUid] || 0) + t;
        }
      }
      const cents = (n: number) => BigInt(Math.round(n * 100));
      return {
        order: {
          id: `sq_order_${++invoiceSeq}`,
          netAmounts: {
            totalMoney: { amount: cents(sub + tax), currency: "CAD" },
            taxMoney: { amount: cents(tax), currency: "CAD" },
          },
          taxes: Object.entries(perTax).map(([uid, v]) => ({
            uid,
            appliedMoney: { amount: cents(v), currency: "CAD" },
          })),
        },
      };
    },
  },
  customers: {
    create: async (body: any) => {
      squareCalls.push({ method: "customers.create", body });
      return { customer: { id: "sq_cust_1" } };
    },
  },
  invoices: {
    create: async (body: any) => {
      squareCalls.push({ method: "invoices.create", body });
      return { invoice: { id: `inv_${invoiceSeq}`, version: 0, publicUrl: null } };
    },
    publish: async (body: any) => {
      squareCalls.push({ method: "invoices.publish", body });
      return { invoice: { id: body.invoiceId, publicUrl: `https://square.test/pay/${body.invoiceId}` } };
    },
    get: async (body: any) => {
      squareCalls.push({ method: "invoices.get", body });
      return {
        invoice: {
          id: body.invoiceId,
          status: "UNPAID",
          publicUrl: `https://square.test/pay/${body.invoiceId}`,
          paymentRequests: [{ computedAmountMoney: { amount: 999999n, currency: "CAD" } }],
        },
      };
    },
    cancel: async (body: any) => {
      squareCalls.push({ method: "invoices.cancel", body });
      return { invoice: { id: body.invoiceId, status: "CANCELED" } };
    },
  },
  payments: { get: async () => ({}), list: async () => ({}), create: async () => ({}) },
  refunds: { refundPayment: async () => ({}) },
};

mock.module("../src/config/square.js", () => ({
  default: squareClient,
  squareConfig: { locationId: "LOC_TEST", applicationId: "APP_TEST", environment: "sandbox" },
  validateSquareConfig: () => true,
  isSquareConfigured: () => true,
}));

// --- Doublure courriel : enregistre au lieu d'envoyer ---------------------
export interface MailCall {
  fn: string;
  args: any[];
}
export const mailCalls: MailCall[] = [];
export const resetMail = () => {
  mailCalls.length = 0;
};

const record = (fn: string) => async (...args: any[]) => {
  mailCalls.push({ fn, args });
};

mock.module("../src/utils/mail.js", () => ({
  sendOrderUpdatedEmail: record("sendOrderUpdatedEmail"),
  sendInvoiceOrderConfirmation: record("sendInvoiceOrderConfirmation"),
  sendOrderConfirmation: record("sendOrderConfirmation"),
  sendFullPaymentReceipt: record("sendFullPaymentReceipt"),
  sendDepositReceipt: record("sendDepositReceipt"),
  sendOrderBalanceEmail: record("sendOrderBalanceEmail"),
  sendPaymentReminderEmail: record("sendPaymentReminderEmail"),
  sendPaymentOverdueEmail: record("sendPaymentOverdueEmail"),
  sendQuoteEmail: record("sendQuoteEmail"),
  sendContactEmail: record("sendContactEmail"),
  sendOrderCancelledEmail: record("sendOrderCancelledEmail"),
}));

mock.module("../src/utils/smsService.js", () => ({
  sendSms: record("sendSms"),
  normalizeSquarePhoneNumber: (p: string) => p || null,
}));

mock.module("../src/utils/emailService.js", () => ({
  sendOrderReceipt: record("sendOrderReceipt"),
}));

mock.module("../src/utils/invoicePdf.js", () => ({
  buildInvoicePdf: async () => Buffer.from("PDF-TEST"),
  invoicePdfFilename: (n: string) => `Facture-${n}.pdf`,
}));
