import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, X, Clock, CheckCircle2, XCircle, FileText } from "lucide-react";
import { normalizedApiUrl } from "../lib/AuthClient";

interface QuoteData {
  _id: string;
  quoteNumber: string;
  clientInfo: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
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
  deliveryType: "pickup" | "delivery";
  pickupLocation?: string;
  deliveryAddress?: {
    street: string;
    city: string;
    province: string;
    postalCode: string;
  };
  billingOrganization?: string;
  notes?: string;
  status: "pending" | "accepted" | "refused" | "expired" | "cancelled";
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
  refusedAt?: string;
  orderId?: string;
}

export default function Quote() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{
    type: "accepted" | "refused";
    orderNumber?: string;
    paymentLinkSent?: boolean;
    paymentLinkChannel?: "email" | "sms";
    paymentLinkError?: string;
  } | null>(null);

  useEffect(() => {
    const fetchQuote = async () => {
      if (!quoteId) return;
      try {
        const response = await fetch(`${normalizedApiUrl}/api/quotes/${quoteId}/public`);
        if (!response.ok) throw new Error(`Erreur ${response.status}`);
        const data = await response.json();
        setQuote(data.data);
      } catch (e: any) {
        setError(e?.message || "Impossible de charger la soumission");
      } finally {
        setLoading(false);
      }
    };
    fetchQuote();
  }, [quoteId]);

  const handleAccept = async () => {
    if (!quoteId) return;
    setProcessing(true);
    try {
      const response = await fetch(`${normalizedApiUrl}/api/quotes/${quoteId}/accept`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Erreur lors de l'acceptation");
      }
      setResult({
        type: "accepted",
        orderNumber: data.data?.orderNumber,
        paymentLinkSent: !!data.data?.paymentLinkSent,
        paymentLinkChannel: data.data?.paymentLinkChannel,
        paymentLinkError: data.data?.paymentLinkError,
      });
      if (quote) setQuote({ ...quote, status: "accepted" });
    } catch (e: any) {
      alert(e?.message || "Erreur lors de l'acceptation de la soumission");
    } finally {
      setProcessing(false);
    }
  };

  const handleRefuse = async () => {
    if (!quoteId) return;
    if (!window.confirm("Voulez-vous vraiment refuser cette soumission ? Cette action est irréversible.")) {
      return;
    }
    setProcessing(true);
    try {
      const response = await fetch(`${normalizedApiUrl}/api/quotes/${quoteId}/refuse`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Erreur lors du refus");
      }
      setResult({ type: "refused" });
      if (quote) setQuote({ ...quote, status: "refused" });
    } catch (e: any) {
      alert(e?.message || "Erreur lors du refus de la soumission");
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9F7F2]">
        <div className="w-12 h-12 border-4 border-[#C5A065] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9F7F2] p-8">
        <div className="text-center max-w-md">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <p className="text-lg text-red-600 mb-4">{error || "Soumission introuvable"}</p>
        </div>
      </div>
    );
  }

  const fmt = (n: number) => (n || 0).toFixed(2) + " $";
  const formatDate = (iso?: string) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("fr-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const isPending = quote.status === "pending";
  const isExpired = quote.status === "expired" || new Date(quote.expiresAt) < new Date();

  return (
    <div className="min-h-screen bg-[#F9F7F2] py-8 px-4">
      <div className="max-w-3xl mx-auto bg-white shadow-lg rounded-2xl p-6 md:p-10">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-[#C5A065] pb-6 mb-6">
          <div>
            <img
              src="https://res.cloudinary.com/deyjooxbi/image/upload/f_jpg/v1773330080/branding/marius_fanny_logo.jpg"
              alt="Marius & Fanny"
              className="h-24 w-auto print:h-28 mb-2"
              crossOrigin="anonymous"
            />
            <p className="text-xs text-gray-600">Pâtisserie Provençale</p>
            <p className="text-xs text-gray-600">239-E boulevard Samson</p>
            <p className="text-xs text-gray-600">Laval, H7X 3E4, Québec, Canada</p>
          </div>
          <div className="text-right">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#C5A065]/10 text-[#C5A065] text-xs font-bold uppercase">
              <FileText size={14} />
              Soumission
            </div>
            <p className="text-sm text-gray-600 mt-2">N° {quote.quoteNumber}</p>
            <p className="text-[11px] text-gray-500">Créée le {formatDate(quote.createdAt)}</p>
          </div>
        </div>

        {/* Status banner */}
        {result?.type === "accepted" && (
          <div className="bg-green-50 border-2 border-green-300 rounded-xl p-5 mb-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-2" />
            <p className="text-lg font-bold text-green-800">Soumission acceptée !</p>
            <p className="text-sm text-green-700 mt-1">
              Votre commande {result.orderNumber ? `#${result.orderNumber.split("-").pop()}` : ""} a été créée.
            </p>
            {result.paymentLinkSent && (
              <p className="text-sm text-green-700 mt-2 font-semibold">
                💳 Un lien de paiement vient de vous être envoyé
                {result.paymentLinkChannel === "sms" ? " par SMS" : " par courriel"}.
              </p>
            )}
            {result.paymentLinkError && (
              <>
                <p className="text-xs text-amber-700 mt-2">
                  ⚠️ Le lien de paiement n'a pas pu être envoyé automatiquement.
                  Réessayez, ou contactez-nous pour finaliser le paiement.
                </p>
                <p className="text-[10px] text-amber-600 mt-1 font-mono">
                  Détail technique : {result.paymentLinkError}
                </p>
              </>
            )}
          </div>
        )}
        {result?.type === "refused" && (
          <div className="bg-gray-50 border-2 border-gray-300 rounded-xl p-5 mb-6 text-center">
            <XCircle className="w-12 h-12 text-gray-500 mx-auto mb-2" />
            <p className="text-lg font-bold text-gray-700">Soumission refusée</p>
            <p className="text-sm text-gray-600 mt-1">Merci pour votre réponse.</p>
          </div>
        )}
        {!result && quote.status === "accepted" && (
          <div className="bg-green-50 border border-green-300 rounded-xl p-4 mb-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-1" />
            <p className="text-sm font-bold text-green-800">Cette soumission a déjà été acceptée</p>
          </div>
        )}
        {!result && quote.status === "refused" && (
          <div className="bg-gray-50 border border-gray-300 rounded-xl p-4 mb-6 text-center">
            <XCircle className="w-8 h-8 text-gray-500 mx-auto mb-1" />
            <p className="text-sm font-bold text-gray-700">Cette soumission a été refusée</p>
          </div>
        )}
        {!result && isExpired && quote.status !== "accepted" && quote.status !== "refused" && (
          <div className="bg-red-50 border border-red-300 rounded-xl p-4 mb-6 text-center">
            <Clock className="w-8 h-8 text-red-500 mx-auto mb-1" />
            <p className="text-sm font-bold text-red-700">Cette soumission a expiré</p>
          </div>
        )}

        {/* Client info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase mb-2">Pour</p>
            <p className="text-sm font-semibold text-gray-900">
              {quote.clientInfo.firstName} {quote.clientInfo.lastName}
            </p>
            {quote.billingOrganization && (
              <p className="text-sm text-gray-700">{quote.billingOrganization}</p>
            )}
            <p className="text-sm text-gray-700">{quote.clientInfo.email}</p>
            {quote.clientInfo.phone && (
              <p className="text-sm text-gray-700">{quote.clientInfo.phone}</p>
            )}
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase mb-2">
              {quote.deliveryType === "delivery" ? "Livraison" : "Ramassage"}
            </p>
            {quote.deliveryType === "delivery" && quote.deliveryAddress ? (
              <>
                <p className="text-sm text-gray-700">{quote.deliveryAddress.street}</p>
                <p className="text-sm text-gray-700">
                  {quote.deliveryAddress.city}, {quote.deliveryAddress.province} {quote.deliveryAddress.postalCode}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-700">{quote.pickupLocation || "Laval"}</p>
            )}
            <p className="text-xs text-gray-500 mt-2">
              Valable jusqu'au <strong>{formatDate(quote.expiresAt)}</strong>
            </p>
          </div>
        </div>

        {/* Items table */}
        <table className="w-full mb-6">
          <thead>
            <tr className="bg-[#F9F7F2] border-b-2 border-[#C5A065]">
              <th className="text-left py-2 px-3 text-xs font-bold uppercase text-gray-700">Produit</th>
              <th className="text-center py-2 px-3 text-xs font-bold uppercase text-gray-700 w-16">Qté</th>
              <th className="text-right py-2 px-3 text-xs font-bold uppercase text-gray-700 w-24">Prix</th>
              <th className="text-right py-2 px-3 text-xs font-bold uppercase text-gray-700 w-24">Montant</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((item, idx) => (
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
                  {item.notes && <div className="text-xs text-gray-500 italic">{item.notes}</div>}
                </td>
                <td className="py-2 px-3 text-center text-sm">{item.quantity}</td>
                <td className="py-2 px-3 text-right text-sm">{fmt(item.unitPrice)}</td>
                <td className="py-2 px-3 text-right text-sm font-medium">{fmt(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end mb-6">
          <div className="w-full md:w-80 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Sous-total :</span>
              <span className="font-medium">{fmt(quote.subtotal)}</span>
            </div>
            {(() => {
              // Same split as the Invoice page so accounting software sees
              // each tax line separately.
              const TPS_RATE = 0.05;
              const TVQ_RATE = 0.09975;
              const TOTAL_RATE = TPS_RATE + TVQ_RATE;
              const tps = quote.taxAmount * (TPS_RATE / TOTAL_RATE);
              const tvq = quote.taxAmount * (TVQ_RATE / TOTAL_RATE);
              return (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">TPS (5 %) :</span>
                    <span className="font-medium">{fmt(tps)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">TVQ (9,975 %) :</span>
                    <span className="font-medium">{fmt(tvq)}</span>
                  </div>
                </>
              );
            })()}
            <div className="text-[10px] text-gray-500 pl-4">
              TPS: 144652641RT001 &nbsp; TVQ: 1201862732TQ0001
            </div>
            {quote.deliveryFee > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-600">Livraison :</span>
                <span className="font-medium">{fmt(quote.deliveryFee)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t-2 border-[#C5A065] text-base font-bold">
              <span className="text-gray-800">TOTAL ESTIMÉ :</span>
              <span className="text-[#C5A065]">{fmt(quote.total)}</span>
            </div>
          </div>
        </div>

        {quote.notes && (
          <div className="bg-amber-50 border-l-4 border-amber-400 p-3 mb-6">
            <p className="text-xs font-bold text-amber-800 uppercase mb-1">Note</p>
            <p className="text-sm text-gray-700 whitespace-pre-line">{quote.notes}</p>
          </div>
        )}

        {/* Action buttons (only if pending and not expired) */}
        {isPending && !isExpired && !result && (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              disabled={processing}
              onClick={handleRefuse}
              className="flex items-center justify-center gap-2 py-4 px-6 rounded-xl border-2 border-gray-300 bg-white text-gray-700 font-bold hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <X size={20} /> Refuser la soumission
            </button>
            <button
              disabled={processing}
              onClick={handleAccept}
              className="flex items-center justify-center gap-2 py-4 px-6 rounded-xl bg-[#337957] text-white font-bold hover:bg-[#2d6b4a] transition-colors disabled:opacity-50"
            >
              {processing ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check size={20} />
              )}
              Accepter la soumission
            </button>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-gray-200 text-center text-xs text-gray-500">
          <p>Merci — Marius & Fanny</p>
        </div>
      </div>
    </div>
  );
}
