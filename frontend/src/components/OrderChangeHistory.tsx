import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import {
  Package,
  DollarSign,
  Clock,
  FileText,
  Truck,
  MapPin,
  Calendar,
  StickyNote,
  Undo2,
  CheckCircle,
} from 'lucide-react';
import { parseServiceDate } from '../utils/dates';

const apiUrl = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

interface OrderChange {
  changedAt: string;
  changedBy?: string;
  field: string;
  oldValue: any;
  newValue: any;
  changeType: 'created' | 'updated' | 'status_changed' | 'payment_updated' | 'items_modified';
  notes?: string;
}

interface OrderChangeHistoryProps {
  orderId: string;
  orderNumber?: string;
}

const statusLabels: Record<string, string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  in_production: "En production",
  ready: "Prête",
  completed: "Terminée",
  cancelled: "Annulée",
  delivered: "Livrée",
};

// Convert a raw change entry into a human-readable French message
function describeChange(change: OrderChange): {
  icon: any;
  color: string;
  title: string;
  details: string[];
} {
  const field = change.field;
  const oldV = change.oldValue;
  const newV = change.newValue;

  // Order created
  if (change.changeType === 'created') {
    return {
      icon: FileText,
      color: "bg-blue-100 text-blue-700",
      title: "Commande créée",
      details: [],
    };
  }

  // Items modified (add/remove products or quantities)
  if (change.changeType === 'items_modified' || field === 'items') {
    const oldItems: any[] = Array.isArray(oldV) ? oldV : [];
    const newItems: any[] = Array.isArray(newV) ? newV : [];
    const details: string[] = [];

    // Build quantity maps
    const oldMap = new Map<string, number>();
    for (const it of oldItems) {
      const key = it.productName || `Produit #${it.productId}`;
      oldMap.set(key, (oldMap.get(key) || 0) + (Number(it.quantity) || 0));
    }
    const newMap = new Map<string, number>();
    for (const it of newItems) {
      const key = it.productName || `Produit #${it.productId}`;
      newMap.set(key, (newMap.get(key) || 0) + (Number(it.quantity) || 0));
    }

    // Find additions, removals, quantity changes
    const allKeys = new Set([...oldMap.keys(), ...newMap.keys()]);
    for (const key of allKeys) {
      const oldQ = oldMap.get(key) || 0;
      const newQ = newMap.get(key) || 0;
      if (oldQ === 0 && newQ > 0) {
        details.push(`➕ Ajouté : ${key} × ${newQ}`);
      } else if (newQ === 0 && oldQ > 0) {
        details.push(`➖ Retiré : ${key} × ${oldQ}`);
      } else if (oldQ !== newQ) {
        details.push(`↕️ ${key} : ${oldQ} → ${newQ}`);
      }
    }

    // Extract total change from notes if available
    const notesMatch = change.notes?.match(/Total:\s*([\d.,]+)\$?\s*->\s*([\d.,]+)/i);
    if (notesMatch) {
      details.push(`💵 Total : ${notesMatch[1]}$ → ${notesMatch[2]}$`);
    }

    return {
      icon: Package,
      color: "bg-orange-100 text-orange-700",
      title: "Produits modifiés",
      details,
    };
  }

  // Status change
  if (field === 'status') {
    const oldLabel = statusLabels[String(oldV)] || String(oldV);
    const newLabel = statusLabels[String(newV)] || String(newV);
    return {
      icon: CheckCircle,
      color: "bg-purple-100 text-purple-700",
      title: `Statut : ${oldLabel} → ${newLabel}`,
      details: [],
    };
  }

  // Payment updates
  if (change.changeType === 'payment_updated' || field === 'depositPaid' || field === 'balancePaid' || field === 'paymentStatus') {
    const title =
      field === 'depositPaid' && newV
        ? "Dépôt marqué comme payé"
        : field === 'balancePaid' && newV
          ? "Solde marqué comme payé"
          : field === 'paymentStatus' && newV === 'paid'
            ? "Commande payée"
            : "Paiement mis à jour";
    return {
      icon: DollarSign,
      color: "bg-green-100 text-green-700",
      title,
      details: change.notes ? [change.notes] : [],
    };
  }

  // Refund
  if (field === 'refunds') {
    const newRefunds: any[] = Array.isArray(newV) ? newV : [];
    const oldRefunds: any[] = Array.isArray(oldV) ? oldV : [];
    const addedRefunds = newRefunds.slice(oldRefunds.length);
    const details = addedRefunds.map((r: any) => {
      const amount = (Number(r.amountCents) || 0) / 100;
      const who = r.employeeName ? ` par ${r.employeeName}` : "";
      return `💸 Remboursement de ${amount.toFixed(2)}$${who}`;
    });
    return {
      icon: Undo2,
      color: "bg-red-100 text-red-700",
      title: "Remboursement effectué",
      details: details.length > 0 ? details : ["Remboursement enregistré"],
    };
  }

  // Pickup / Delivery date
  if (field === 'pickupDate' || field === 'deliveryDate') {
    const formatDate = (v: any) => {
      try {
        const parsed = parseServiceDate(v);
        if (!parsed) return "—";
        // deliveryDate est un JOUR (« 2026-08-14 ») : afficher une heure y serait
        // trompeur (et minuit UTC affichait la veille).
        const dayOnly = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
        return parsed.toLocaleString('fr-CA', {
          dateStyle: 'medium',
          ...(dayOnly ? {} : { timeStyle: 'short' as const }),
          timeZone: 'America/Montreal',
        });
      } catch { return String(v); }
    };
    return {
      icon: Calendar,
      color: "bg-blue-100 text-blue-700",
      title: `Date ${field === 'pickupDate' ? 'de ramassage' : 'de livraison'} modifiée`,
      details: [`${formatDate(oldV)} → ${formatDate(newV)}`],
    };
  }

  // Pickup location
  if (field === 'pickupLocation') {
    return {
      icon: MapPin,
      color: "bg-blue-100 text-blue-700",
      title: `Lieu de ramassage : ${oldV || "—"} → ${newV || "—"}`,
      details: [],
    };
  }

  // Delivery type
  if (field === 'deliveryType') {
    const label = (v: any) => (v === 'delivery' ? 'Livraison' : v === 'pickup' ? 'Ramassage' : String(v));
    return {
      icon: Truck,
      color: "bg-blue-100 text-blue-700",
      title: `Mode : ${label(oldV)} → ${label(newV)}`,
      details: [],
    };
  }

  // Delivery address
  if (field === 'deliveryAddress') {
    const fmt = (v: any) =>
      v && typeof v === 'object'
        ? `${v.street || ''}, ${v.city || ''} ${v.postalCode || ''}`.trim()
        : "—";
    return {
      icon: MapPin,
      color: "bg-blue-100 text-blue-700",
      title: "Adresse de livraison modifiée",
      details: [`Nouvelle : ${fmt(newV)}`],
    };
  }

  // Client info
  if (field === 'clientInfo') {
    return {
      icon: StickyNote,
      color: "bg-gray-100 text-gray-700",
      title: "Informations du client mises à jour",
      details: [],
    };
  }

  // Notes
  if (field === 'notes') {
    return {
      icon: StickyNote,
      color: "bg-yellow-100 text-yellow-700",
      title: "Note modifiée",
      details: newV ? [String(newV)] : [],
    };
  }

  // Default / fallback
  return {
    icon: FileText,
    color: "bg-gray-100 text-gray-700",
    title: change.notes || `Champ "${field}" modifié`,
    details: [],
  };
}

export default function OrderChangeHistory({ orderId, orderNumber }: OrderChangeHistoryProps) {
  const [history, setHistory] = useState<OrderChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setLoading(true);
        setError(null);

        const token = localStorage.getItem('bearer_token');
        const response = await fetch(`${apiUrl}/api/orders/${orderId}/history`, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          throw new Error(`Impossible de charger l'historique (${response.status}) ${errBody.slice(0, 200)}`);
        }

        const result = await response.json();
        setHistory(result.data?.changeHistory || []);
      } catch (err: any) {
        console.error('Error fetching order history:', err);
        setError(err?.message || "Impossible de charger l'historique des modifications");
      } finally {
        setLoading(false);
      }
    };

    if (orderId) {
      fetchHistory();
    }
  }, [orderId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Historique de la commande</CardTitle>
          <CardDescription>Chargement...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#C5A065]"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Historique de la commande</CardTitle>
          <CardDescription className="text-red-600">{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Historique de la commande</CardTitle>
          <CardDescription>Aucune modification enregistrée pour cette commande.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Sort by date descending (most recent first)
  const sorted = [...history].sort(
    (a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime(),
  );

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-[#C5A065]" />
          Historique de la commande
        </CardTitle>
        <CardDescription>
          {orderNumber && `Commande ${orderNumber} • `}
          {history.length} événement{history.length > 1 ? 's' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
          {sorted.map((change, idx) => {
            const desc = describeChange(change);
            const Icon = desc.icon;
            const date = new Date(change.changedAt).toLocaleString('fr-CA', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <div
                key={idx}
                className="flex gap-3 p-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
              >
                <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${desc.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{desc.title}</p>
                  {desc.details.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {desc.details.map((d, i) => (
                        <li key={i} className="text-xs text-gray-600">
                          {d}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-gray-400 mt-1">{date}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
