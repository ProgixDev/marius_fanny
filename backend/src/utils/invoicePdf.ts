import PDFDocument from "pdfkit";

/**
 * Génération de la facture en PDF, pour la joindre aux courriels (les clients
 * gouvernementaux exigent la facture en pièce jointe, un lien « Télécharger la
 * facture » ne suffit pas pour leur service des comptes payables).
 *
 * Le contenu reprend exactement la page /facture/:orderId du site : mêmes
 * coordonnées, mêmes numéros de TPS/TVQ, mêmes totaux.
 */

const GOLD = "#C5A065";
const DARK = "#2D2A26";
const GREY = "#666666";

const LOGO_URL =
  "https://res.cloudinary.com/deyjooxbi/image/upload/f_jpg/v1773330080/branding/marius_fanny_logo.jpg";

// Le logo ne change jamais : on le télécharge une seule fois par process.
let logoCache: Buffer | null | undefined;

async function fetchLogo(): Promise<Buffer | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(LOGO_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    logoCache = Buffer.from(await res.arrayBuffer());
  } catch (e: any) {
    // Sans logo la facture reste valide — on ne bloque jamais l'envoi.
    console.warn("⚠️ [FACTURE PDF] Logo indisponible:", e?.message || e);
    logoCache = null;
  }
  return logoCache;
}

export interface InvoicePdfItem {
  productName: string;
  quantity: number;
  unitPrice?: number;
  amount: number;
  notes?: string;
  selectedOptions?: Record<string, string> | null;
}

export interface InvoicePdfData {
  orderNumber: string;
  orderDate?: Date | string;
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  organization?: string;
  deliveryType?: "pickup" | "delivery";
  pickupLocation?: string;
  deliveryAddress?: {
    street?: string;
    city?: string;
    province?: string;
    postalCode?: string;
  } | null;
  serviceDate?: Date | string | null;
  timeSlot?: string;
  items: InvoicePdfItem[];
  subtotal: number;
  /** Découpage réel stocké sur la commande. Absent = anciennes commandes. */
  tpsAmount?: number | null;
  tvqAmount?: number | null;
  /** Total des taxes — sert de repli quand le découpage n'est pas stocké. */
  taxAmount?: number;
  deliveryFee?: number;
  total: number;
  amountPaid?: number;
  notes?: string;
}

const money = (n: number) => `${(Number(n) || 0).toFixed(2)} $`;

const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;
const COMBINED_RATE = TPS_RATE + TVQ_RATE;

/**
 * Montants TPS/TVQ à imprimer. Même règle que les courriels : on utilise le
 * découpage réel stocké sur la commande (indispensable depuis que certains
 * produits n'ont que la TPS) et, à défaut, on répartit le total par proportion.
 */
function taxParts(data: InvoicePdfData): { tps: number; tvq: number } {
  const tps = data.tpsAmount || 0;
  const tvq = data.tvqAmount || 0;
  if (tps + tvq > 0) return { tps, tvq };

  const taxAmount = data.taxAmount || 0;
  return {
    tps: taxAmount * (TPS_RATE / COMBINED_RATE),
    tvq: taxAmount * (TVQ_RATE / COMBINED_RATE),
  };
}

const formatDate = (value?: Date | string | null) => {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Montreal",
  });
};

/** Nom de fichier lisible pour la pièce jointe : Facture-0236.pdf */
export function invoicePdfFilename(orderNumber: string): string {
  const short = String(orderNumber || "").split("-").pop() || orderNumber || "commande";
  return `Facture-${short}.pdf`;
}

export async function buildInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const logo = await fetchLogo();
  const { tps: tpsAmount, tvq: tvqAmount } = taxParts(data);

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const width = right - left;
      const shortNumber =
        String(data.orderNumber || "").split("-").pop() || data.orderNumber || "";

      // ---------- En-tête : logo + coordonnées à gauche, FACTURE à droite ----------
      const headerTop = doc.y;
      if (logo) {
        doc.image(logo, left, headerTop, { fit: [130, 60] });
      } else {
        doc.font("Helvetica-Bold").fontSize(18).fillColor(DARK).text("Marius & Fanny", left, headerTop);
      }

      doc.font("Helvetica").fontSize(9).fillColor(GREY);
      doc.text("Pâtisserie Provençale", left, headerTop + 68, { width: 260 });
      doc.text("239-E boulevard Samson", { width: 260 });
      doc.text("Laval, H7X 3E4, Québec, Canada", { width: 260 });

      doc.font("Helvetica-Bold").fontSize(20).fillColor(DARK);
      doc.text("FACTURE", left, headerTop + 4, { width, align: "right" });
      doc.font("Helvetica").fontSize(10).fillColor(GREY);
      doc.text(`N° ${shortNumber}`, left, headerTop + 30, { width, align: "right" });
      doc.fontSize(9).text(formatDate(data.orderDate), left, headerTop + 46, {
        width,
        align: "right",
      });

      let y = Math.max(doc.y, headerTop + 108) + 10;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(2).strokeColor(GOLD).stroke();
      y += 18;

      // ---------- Facturé à / Ramassage-Livraison ----------
      const colWidth = width / 2 - 10;
      const blockTop = y;

      doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY).text("FACTURÉ À", left, y, { width: colWidth });
      doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text(data.clientName || "", left, doc.y + 3, { width: colWidth });
      doc.font("Helvetica").fontSize(9).fillColor(GREY);
      if (data.organization) doc.text(data.organization, { width: colWidth });
      if (data.clientEmail) doc.text(data.clientEmail, { width: colWidth });
      if (data.clientPhone) doc.text(data.clientPhone, { width: colWidth });
      const leftBottom = doc.y;

      const rightX = left + colWidth + 20;
      const isDelivery = data.deliveryType === "delivery";
      doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY)
        .text(isDelivery ? "LIVRAISON" : "RAMASSAGE", rightX, blockTop, { width: colWidth });
      doc.font("Helvetica").fontSize(9).fillColor(GREY);
      if (isDelivery && data.deliveryAddress) {
        const a = data.deliveryAddress;
        if (a.street) doc.text(a.street, rightX, doc.y + 3, { width: colWidth });
        const line2 = [a.city, a.province, a.postalCode].filter(Boolean).join(", ");
        if (line2) doc.text(line2, rightX, doc.y, { width: colWidth });
      } else {
        doc.text(data.pickupLocation || "Laval", rightX, blockTop + 14, { width: colWidth });
      }
      const serviceDate = formatDate(data.serviceDate);
      if (serviceDate) doc.text(`Date : ${serviceDate}`, rightX, doc.y, { width: colWidth });
      if (data.timeSlot) doc.text(`Heure : ${data.timeSlot}`, rightX, doc.y, { width: colWidth });

      y = Math.max(leftBottom, doc.y) + 22;

      // ---------- Tableau des articles ----------
      const colQty = right - 210;
      const colUnit = right - 150;
      const colAmount = right - 70;

      const drawTableHeader = (top: number) => {
        doc.rect(left, top - 4, width, 20).fillColor("#F9F7F2").fill();
        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text("PRODUIT", left + 4, top + 1, { width: colQty - left - 10 });
        doc.text("QTÉ", colQty, top + 1, { width: 50, align: "center" });
        doc.text("PRIX", colUnit, top + 1, { width: 70, align: "right" });
        doc.text("MONTANT", colAmount, top + 1, { width: 70, align: "right" });
        const bottom = top + 16;
        doc.moveTo(left, bottom).lineTo(right, bottom).lineWidth(1.5).strokeColor(GOLD).stroke();
        return bottom + 6;
      };

      y = drawTableHeader(y);

      for (const item of data.items || []) {
        // Saut de page si la ligne ne rentre plus.
        if (y > doc.page.height - 160) {
          doc.addPage();
          y = doc.page.margins.top;
          y = drawTableHeader(y);
        }

        const detailLines: string[] = [];
        for (const [key, value] of Object.entries(item.selectedOptions || {})) {
          if (value && String(value).trim()) detailLines.push(`${key} : ${String(value).trim()}`);
        }
        if (item.notes && String(item.notes).trim()) {
          detailLines.push(String(item.notes).trim());
        }

        doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK);
        doc.text(item.productName || "Article", left + 4, y, { width: colQty - left - 14 });
        let rowBottom = doc.y;

        if (detailLines.length > 0) {
          doc.font("Helvetica").fontSize(8).fillColor(GREY);
          doc.text(detailLines.join("\n"), left + 10, doc.y + 1, { width: colQty - left - 20 });
          rowBottom = doc.y;
        }

        doc.font("Helvetica").fontSize(9).fillColor(DARK);
        doc.text(String(item.quantity ?? ""), colQty, y, { width: 50, align: "center" });
        doc.text(
          item.unitPrice !== undefined && item.unitPrice !== null ? money(item.unitPrice) : "",
          colUnit,
          y,
          { width: 70, align: "right" },
        );
        doc.text(money(item.amount), colAmount, y, { width: 70, align: "right" });

        rowBottom = Math.max(rowBottom, y + 12) + 6;
        doc.moveTo(left, rowBottom - 3).lineTo(right, rowBottom - 3)
          .lineWidth(0.5).strokeColor("#DDDDDD").stroke();
        y = rowBottom;
      }

      // ---------- Totaux ----------
      y += 12;
      if (y > doc.page.height - 190) {
        doc.addPage();
        y = doc.page.margins.top;
      }

      const totalsX = right - 250;
      const totalsLabelWidth = 150;
      const totalsValueX = right - 90;

      const totalLine = (label: string, value: string, bold = false) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(bold ? DARK : GREY);
        doc.text(label, totalsX, y, { width: totalsLabelWidth });
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(DARK);
        doc.text(value, totalsValueX, y, { width: 90, align: "right" });
        y += 14;
      };

      totalLine("Sous-total :", money(data.subtotal));
      totalLine("TPS (5 %) :", money(tpsAmount));
      totalLine("TVQ (9,975 %) :", money(tvqAmount));

      doc.font("Helvetica").fontSize(7).fillColor(GREY);
      doc.text("TPS: 144652641RT001    TVQ: 1201862732TQ0001", totalsX, y, { width: 240 });
      y += 12;

      if ((data.deliveryFee || 0) > 0) {
        totalLine("Livraison :", money(data.deliveryFee || 0));
      }

      doc.moveTo(totalsX, y).lineTo(right, y).lineWidth(1.5).strokeColor(GOLD).stroke();
      y += 8;
      doc.font("Helvetica-Bold").fontSize(12).fillColor(DARK);
      doc.text("TOTAL :", totalsX, y, { width: totalsLabelWidth });
      doc.fillColor(GOLD).text(money(data.total), totalsValueX - 10, y, { width: 100, align: "right" });
      y += 22;

      const paid = data.amountPaid || 0;
      if (paid > 0) {
        doc.fillColor(DARK);
        totalLine("Montant payé :", money(paid));
        const balance = (data.total || 0) - paid;
        if (balance > 0.01) totalLine("Solde à payer :", money(balance), true);
      }

      // ---------- Note ----------
      if (data.notes && String(data.notes).trim()) {
        y += 10;
        doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY).text("NOTE", left, y, { width });
        doc.font("Helvetica").fontSize(9).fillColor(DARK)
          .text(String(data.notes).trim(), left, doc.y + 2, { width });
        y = doc.y;
      }

      // ---------- Pied de page ----------
      const footerY = Math.max(y + 30, doc.page.height - 90);
      doc.moveTo(left, footerY).lineTo(right, footerY).lineWidth(0.5).strokeColor("#DDDDDD").stroke();
      doc.font("Helvetica").fontSize(8).fillColor(GREY);
      doc.text("Merci pour votre confiance — Marius & Fanny", left, footerY + 8, {
        width,
        align: "center",
      });
      doc.text("www.mariusetfanny.com", left, doc.y + 2, { width, align: "center" });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
