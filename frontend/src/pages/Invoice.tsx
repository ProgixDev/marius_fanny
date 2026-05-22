import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Download } from "lucide-react";
import { normalizedApiUrl } from "../lib/AuthClient";

interface OrderData {
  _id: string;
  orderNumber: string;
  clientInfo: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  pickupDate?: string;
  pickupLocation?: string;
  deliveryType: "pickup" | "delivery";
  deliveryAddress?: {
    street: string;
    city: string;
    province: string;
    postalCode: string;
  };
  deliveryDate?: string;
  deliveryTimeSlot?: string;
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    notes?: string;
    selectedOptions?: Record<string, string>;
  }>;
  subtotal: number;
  taxAmount: number;
  deliveryFee: number;
  total: number;
  amountPaid: number;
  paymentStatus: string;
  billingKind?: string;
  billingOrganization?: string;
  orderDate: string;
  notes?: string;
}

export default function Invoice() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOrder = async () => {
      if (!orderId) return;
      try {
        const response = await fetch(
          `${normalizedApiUrl}/api/orders/${orderId}/public`,
          { credentials: "include" },
        );
        if (!response.ok) {
          throw new Error(`Erreur ${response.status}`);
        }
        const data = await response.json();
        setOrder(data.data);
      } catch (e: any) {
        setError(e?.message || "Impossible de charger la facture");
      } finally {
        setLoading(false);
      }
    };
    fetchOrder();
  }, [orderId]);

  // Auto-trigger print dialog once the invoice is loaded and rendered
  useEffect(() => {
    if (!loading && order && !error) {
      const timer = setTimeout(() => window.print(), 500);
      return () => clearTimeout(timer);
    }
  }, [loading, order, error]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-12 h-12 border-4 border-[#C5A065] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-8">
        <div className="text-center">
          <p className="text-lg text-red-600 mb-4">{error || "Facture introuvable"}</p>
        </div>
      </div>
    );
  }

  const formatDate = (iso?: string) => {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("fr-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const fmt = (n: number) => (n || 0).toFixed(2) + " $";
  const shortNum = order.orderNumber.split("-").pop() || order.orderNumber;
  const balance = (order.total || 0) - (order.amountPaid || 0);

  return (
    <div className="min-h-screen bg-gray-100 py-8 print:bg-white print:py-0">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 1cm; size: A4; }
          /* Force browsers (Chrome/Edge in particular) to keep our backgrounds
             and brand colors when generating the PDF, otherwise the gold border
             and the bg-[#F9F7F2] header strip get dropped. */
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          /* Make sure the logo image isn't shrunk by the browser's default
             "shrink to fit" — keep it crisp at its declared size. */
          img { max-width: 100% !important; }
        }
      `}</style>

      <div className="max-w-3xl mx-auto bg-white shadow-lg print:shadow-none p-8 md:p-12">
        {/* Action buttons (not printed) */}
        <div className="no-print flex justify-end gap-2 mb-6">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-[#C5A065] text-white rounded-lg hover:bg-[#b8935a] transition-colors"
          >
            <Download size={18} /> Télécharger la facture
          </button>
        </div>

        {/* Header — same f_jpg URL used in all transactional emails so the
            facture, l'email et l'impression partagent la même image (AVIF est
            rejeté par plusieurs lecteurs PDF/aperçus d'impression). */}
        <div className="flex items-start justify-between border-b-2 border-[#C5A065] pb-6 mb-6">
          <div className="flex items-center gap-4">
            <img
              src="https://res.cloudinary.com/deyjooxbi/image/upload/f_jpg/v1773330080/branding/marius_fanny_logo.jpg"
              alt="Marius & Fanny"
              className="h-20 w-auto print:h-24"
              crossOrigin="anonymous"
            />
            <div>
              <h1
                style={{ fontFamily: '"Great Vibes", cursive' }}
                className="text-4xl text-[#C5A065] mb-1"
              >
                Marius & Fanny
              </h1>
              <p className="text-xs text-gray-600">Pâtisserie Provençale</p>
              <p className="text-xs text-gray-600">239 Boulevard Samson, Laval, QC</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-800">FACTURE</p>
            <p className="text-sm text-gray-600 mt-1">N° {shortNum}</p>
            <p className="text-xs text-gray-500 mt-1">{formatDate(order.orderDate)}</p>
          </div>
        </div>

        {/* Client info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase mb-2">Facturé à</p>
            <p className="text-sm font-semibold text-gray-900">
              {order.clientInfo.firstName} {order.clientInfo.lastName}
            </p>
            {order.billingOrganization && (
              <p className="text-sm text-gray-700">{order.billingOrganization}</p>
            )}
            <p className="text-sm text-gray-700">{order.clientInfo.email}</p>
            <p className="text-sm text-gray-700">{order.clientInfo.phone}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase mb-2">
              {order.deliveryType === "delivery" ? "Livraison" : "Ramassage"}
            </p>
            {order.deliveryType === "delivery" && order.deliveryAddress ? (
              <>
                <p className="text-sm text-gray-700">{order.deliveryAddress.street}</p>
                <p className="text-sm text-gray-700">
                  {order.deliveryAddress.city}, {order.deliveryAddress.province}{" "}
                  {order.deliveryAddress.postalCode}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-700">{order.pickupLocation || "Laval"}</p>
            )}
            {(order.pickupDate || order.deliveryDate) && (
              <p className="text-sm text-gray-700 mt-1">
                Date : {formatDate(order.pickupDate || order.deliveryDate)}
              </p>
            )}
            {order.deliveryTimeSlot && (
              <p className="text-sm text-gray-700">Heure : {order.deliveryTimeSlot}</p>
            )}
          </div>
        </div>

        {/* Items table */}
        <table className="w-full mb-6">
          <thead>
            <tr className="bg-[#F9F7F2] border-b-2 border-[#C5A065]">
              <th className="text-left py-2 px-3 text-xs font-bold uppercase text-gray-700">
                Produit
              </th>
              <th className="text-center py-2 px-3 text-xs font-bold uppercase text-gray-700 w-16">
                Qté
              </th>
              <th className="text-right py-2 px-3 text-xs font-bold uppercase text-gray-700 w-24">
                Prix
              </th>
              <th className="text-right py-2 px-3 text-xs font-bold uppercase text-gray-700 w-24">
                Montant
              </th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, idx) => (
              <tr key={idx} className="border-b border-gray-200">
                <td className="py-2 px-3 text-sm">
                  <div className="font-medium text-gray-900">{item.productName}</div>
                  {item.selectedOptions &&
                    Object.entries(item.selectedOptions)
                      .filter(([_, v]) => v && String(v).trim())
                      .map(([k, v]) => (
                        <div key={k} className="text-xs text-gray-500">
                          {k}: {String(v)}
                        </div>
                      ))}
                  {item.notes && (
                    <div className="text-xs text-gray-500 italic">{item.notes}</div>
                  )}
                </td>
                <td className="py-2 px-3 text-center text-sm">{item.quantity}</td>
                <td className="py-2 px-3 text-right text-sm">{fmt(item.unitPrice)}</td>
                <td className="py-2 px-3 text-right text-sm font-medium">
                  {fmt(item.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end mb-8">
          <div className="w-full md:w-80 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Sous-total :</span>
              <span className="font-medium">{fmt(order.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Taxes (TPS + TVQ) :</span>
              <span className="font-medium">{fmt(order.taxAmount)}</span>
            </div>
            <div className="text-[10px] text-gray-500 pl-4">
              TPS: 144652641RT001 &nbsp; TVQ: 1201862732TQ0001
            </div>
            {order.deliveryFee > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-600">Livraison :</span>
                <span className="font-medium">{fmt(order.deliveryFee)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t-2 border-[#C5A065] text-base font-bold">
              <span className="text-gray-800">TOTAL :</span>
              <span className="text-[#C5A065]">{fmt(order.total)}</span>
            </div>
            {order.amountPaid > 0 && (
              <>
                <div className="flex justify-between text-xs pt-2">
                  <span className="text-gray-500">Montant payé :</span>
                  <span className="text-green-700 font-medium">{fmt(order.amountPaid)}</span>
                </div>
                {balance > 0.01 && (
                  <div className="flex justify-between text-sm font-bold text-orange-700">
                    <span>Solde à payer :</span>
                    <span>{fmt(balance)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Note */}
        {order.notes && (
          <div className="bg-amber-50 border-l-4 border-amber-400 p-3 mb-6">
            <p className="text-xs font-bold text-amber-800 uppercase mb-1">Note</p>
            <p className="text-sm text-gray-700 whitespace-pre-line">{order.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-gray-200 text-center text-xs text-gray-500">
          <p>Merci pour votre confiance — Marius & Fanny</p>
          <p className="mt-1">www.mariusetfanny.com</p>
        </div>
      </div>
    </div>
  );
}
