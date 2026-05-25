import React, { useState, useEffect } from "react";
import { 
  ChefHat, 
  Clock, 
  Package, 
  AlertCircle,
  Search,
  Printer,
  Download,
  RefreshCw,
  LayoutGrid,
  List,
  ArrowUpDown
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

const getLocalDateYYYYMMDD = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

interface ProductionItem {
  id: string;
  orderId: string;
  orderNumber: string;
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  customerName: string;
  customerPhone: string;
  deliveryDate: string;
  deliveryTimeSlot: string;
  deliveryType: "pickup" | "delivery";
  pickupLocation: string;
  orderStatus: string;
  notes: string;
  selectedOptions?: Record<string, string>;
  allergies?: string; // Ajout des allergies
  // Simple statut: fait ou pas fait
  done: boolean;
}

interface GroupedProduct {
  productId: number;
  productName: string;
  totalQuantity: number;
  items: ProductionItem[];
  allergies: string[]; // Liste des allergies uniques pour ce produit
}

interface OrderGroup {
  orderId: string;
  orderNumber: string;
  deliveryTimeSlot: string;
  deliveryType: "pickup" | "delivery";
  allergies: string[];
  items: ProductionItem[];
  done: boolean;
}

const isMontrealPickup = (item: Pick<ProductionItem, "deliveryType" | "pickupLocation">) => {
  if (item.deliveryType !== "pickup") return false;
  const location = (item.pickupLocation || "").toLowerCase();
  return location.includes("montreal") || location.includes("montr");
};

const normalizeOptionName = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const isAllergyOptionName = (name: string) =>
  normalizeOptionName(name).includes("allerg");

const getNonAllergyOptionsText = (options?: Record<string, string>) => {
  const parts = Object.entries(options || {})
    .filter(([k, v]) => !isAllergyOptionName(k) && String(v || "").trim())
    .map(([k, v]) => `${k}: ${String(v).trim()}`);
  return parts.length > 0 ? parts.join(" • ") : "";
};

const extractAllergies = (item: Pick<ProductionItem, "allergies" | "notes" | "selectedOptions">) => {
  if (item.allergies) return item.allergies;

  const fromOptions = Object.entries(item.selectedOptions || {})
    .filter(([key, value]) => isAllergyOptionName(key) && String(value || "").trim())
    .map(([, value]) => String(value).trim())
    .filter(Boolean);
  if (fromOptions.length > 0) return fromOptions.join(", ");

  return item.notes?.match(/allergie?[^.]*/i)?.[0] || null;
};

const parseTimeSlotStartMinutes = (slot: string | undefined | null) => {
  const value = String(slot || "").trim().toLowerCase();
  if (!value || value.includes("non sp")) return Number.POSITIVE_INFINITY;

  // Matches: "9", "9h", "9:30", "9h30", "09:30", "9 h 30"
  const match = value.match(/(\d{1,2})\s*(?:h|:)?\s*(\d{2})?/);
  if (!match) return Number.POSITIVE_INFINITY;

  const hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  if (!Number.isFinite(hours) || hours < 0 || hours > 23) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 59) return Number.POSITIVE_INFINITY;
  return hours * 60 + minutes;
};

const getFulfillmentAccent = (item: Pick<ProductionItem, "deliveryType" | "pickupLocation">) => {
  if (item.deliveryType === "delivery") {
    return {
      borderClass: "border-l-4 border-l-yellow-400",
      pillClass: "bg-yellow-100 text-yellow-900 border-yellow-200",
      label: "Livraison",
    };
  }

  if (isMontrealPickup(item)) {
    return {
      borderClass: "border-l-4 border-l-blue-400",
      pillClass: "bg-blue-100 text-blue-900 border-blue-200",
      label: "Cueillette Montréal",
    };
  }

  if (item.deliveryType === "pickup") {
    return {
      borderClass: "border-l-4 border-l-stone-200",
      pillClass: "bg-white text-stone-700 border-stone-200",
      label: "Cueillette Laval",
    };
  }

  return null;
};

interface ProductionListProps {
  filterByType?: "patisserie" | "cuisinier" | "four";
}

const ProductionList: React.FC<ProductionListProps> = ({ filterByType } = {}) => {
  const [productionItems, setProductionItems] = useState<ProductionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDate, setSelectedDate] = useState<string>(
    getLocalDateYYYYMMDD()
  );
  const [viewMode, setViewMode] = useState<"list" | "orders">("list"); // Deux vues
  const [sortByPickupTime, setSortByPickupTime] = useState(false);

  // Fetch production data from API
  useEffect(() => {
    fetchProductionData();
  }, [selectedDate]);

  const fetchProductionData = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_URL}/api/orders/production?date=${selectedDate}`,
        {
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (response.status === 401) {
        return;
      }

      if (!response.ok) {
        throw new Error(`Erreur ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const apiItems = result.data?.items || [];


      let items: ProductionItem[] = apiItems.map((item: any) => ({
        ...item,
        allergies: extractAllergies(item),
        done: !!item.done,
      }));

      // Filter by production type if specified
      if (filterByType) {
        items = items.filter((item: any) => item.productionType === filterByType);
      }

      setProductionItems(items);
    } catch (err: any) {
      console.error("❌ Erreur chargement production:", err);
      setError(err.message || "Impossible de charger la liste de production");
    } finally {
      setLoading(false);
    }
  };

  const toggleDone = async (itemId: string) => {
    const item = productionItems.find((i) => i.id === itemId);
    if (!item) return;

    const nextDone = !item.done;

    setProductionItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, done: nextDone } : i)),
    );

    try {
      const response = await fetch(`${API_URL}/api/orders/production/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productionItemId: item.id,
          date: selectedDate,
          done: nextDone,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          location: item.pickupLocation,
        }),
      });

      if (!response.ok) {
        throw new Error(`Erreur ${response.status}: ${response.statusText}`);
      }
    } catch (err: any) {
      console.error("❌ Erreur mise à jour statut:", err);
      setProductionItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, done: !nextDone } : i)),
      );
      setError(err.message || "Impossible de mettre à jour le statut");
    }
  };

  const toggleOrderDone = async (orderId: string) => {
    const orderItems = productionItems.filter(i => i.orderId === orderId);
    if (orderItems.length === 0) return;

    const allDone = orderItems.every(i => i.done);
    const nextDone = !allDone;

    setProductionItems(prev =>
      prev.map(i => i.orderId === orderId ? { ...i, done: nextDone } : i)
    );

    try {
      await Promise.all(orderItems.map(item =>
        fetch(`${API_URL}/api/orders/production/status`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productionItemId: item.id,
            date: selectedDate,
            done: nextDone,
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            location: item.pickupLocation,
          }),
        })
      ));
    } catch (err: any) {
      console.error("❌ Erreur mise à jour statut commande:", err);
      setProductionItems(prev =>
        prev.map(i => i.orderId === orderId ? { ...i, done: !nextDone } : i)
      );
    }
  };

  const toggleProductDone = async (productId: number) => {
    const productItems = productionItems.filter(i => i.productId === productId);
    if (productItems.length === 0) return;

    const allDone = productItems.every(i => i.done);
    const nextDone = !allDone;

    setProductionItems(prev =>
      prev.map(i => i.productId === productId ? { ...i, done: nextDone } : i)
    );

    try {
      await Promise.all(productItems.map(item =>
        fetch(`${API_URL}/api/orders/production/status`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productionItemId: item.id,
            date: selectedDate,
            done: nextDone,
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            location: item.pickupLocation,
          }),
        })
      ));
    } catch (err: any) {
      console.error("❌ Erreur mise à jour statut produit:", err);
      setProductionItems(prev =>
        prev.map(i => i.productId === productId ? { ...i, done: !nextDone } : i)
      );
    }
  };

  // Align order number display with the Commandes page formatting
  const formatOrderNumber = (orderNumber: string) => {
    const trimmed = orderNumber.trim();
    const mfMatch = trimmed.match(/^(MF-\d{8}-)(\d{1,4})$/i);
    if (mfMatch) {
      return mfMatch[2].padStart(4, "0");
    }

    if (!/^\d+$/.test(trimmed)) return orderNumber;
    const numeric = Number(trimmed);
    if (Number.isNaN(numeric) || numeric < 0 || numeric > 1000) return orderNumber;
    return String(numeric).padStart(4, "0");
  };

  // Grouper les produits pour la vue liste
  const groupedProducts: GroupedProduct[] = React.useMemo(() => {
    // Custom items (admin's "Ajouter article personnalisé") all share
    // productId = 0, so the old `Map<number, ...>` keyed on productId
    // merged every custom item into one row — qty got summed across
    // different products (COOKIES + BISCUIS appeared as a single
    // "COOKIES x 2" line). Key custom items by their name instead so
    // each personalized product gets its own group.
    const groups = new Map<string, GroupedProduct>();

    productionItems.forEach((item) => {
      const isCustom = !item.productId || item.productId === 0;
      const key = isCustom
        ? `custom:${(item.productName || "").trim().toLowerCase()}`
        : `id:${item.productId}`;

      if (!groups.has(key)) {
        groups.set(key, {
          productId: item.productId,
          productName: item.productName,
          totalQuantity: 0,
          items: [],
          allergies: [],
        });
      }

      const group = groups.get(key)!;
      group.totalQuantity += item.quantity;
      group.items.push(item);

      if (item.allergies) {
        const allergies = item.allergies.split(",").map((a) => a.trim());
        allergies.forEach((allergy) => {
          if (!group.allergies.includes(allergy)) {
            group.allergies.push(allergy);
          }
        });
      }
    });

    return Array.from(groups.values());
  }, [productionItems]);

  // Grouper les éléments par commande pour la vue par commande
  const groupedOrders: OrderGroup[] = React.useMemo(() => {
    const groups = new Map<string, OrderGroup>();

    productionItems.forEach(item => {
      const key = item.orderId || item.orderNumber;
      if (!groups.has(key)) {
        groups.set(key, {
          orderId: item.orderId || item.orderNumber,
          orderNumber: item.orderNumber,
          deliveryTimeSlot: item.deliveryTimeSlot,
          deliveryType: item.deliveryType,
          allergies: [],
          items: [],
          done: false,
        });
      }

      const group = groups.get(key)!;
      group.items.push(item);

      if (item.allergies) {
        item.allergies.split(',').map(a => a.trim()).forEach(allergy => {
          if (!group.allergies.includes(allergy)) group.allergies.push(allergy);
        });
      }
    });

    groups.forEach(group => {
      group.done = group.items.every(i => i.done);
    });

    return Array.from(groups.values());
  }, [productionItems]);

  // Filtrer les articles
  const filteredItems = productionItems.filter(item => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (
        item.productName.toLowerCase().includes(term) ||
        item.orderNumber.toLowerCase().includes(term) ||
        formatOrderNumber(item.orderNumber).toLowerCase().includes(term) ||
        item.customerName.toLowerCase().includes(term)
      );
    }
    return true;
  });

  const filteredGroups = groupedProducts.filter(group => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return group.productName.toLowerCase().includes(term);
    }
    return true;
  });

  const filteredOrders: OrderGroup[] = React.useMemo(() => {
    let orders = groupedOrders;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      orders = orders.filter(group =>
        group.orderNumber.toLowerCase().includes(term) ||
        group.items.some(i => i.productName.toLowerCase().includes(term))
      );
    }
    if (sortByPickupTime) {
      orders = [...orders].sort((a, b) =>
        parseTimeSlotStartMinutes(a.deliveryTimeSlot) - parseTimeSlotStartMinutes(b.deliveryTimeSlot)
      );
    }
    return orders;
  }, [groupedOrders, searchTerm, sortByPickupTime]);

  const doneItems = filteredItems.filter(item => item.done);
  const notDoneItems = filteredItems.filter(item => !item.done);

  // Inventory adjustments are handled elsewhere (not from the production list).

  // Vue par commandes — groupée par numéro de commande
  const OrdersView = () => {
    const notDoneOrders = filteredOrders.filter(g => !g.done);
    const doneOrders = filteredOrders.filter(g => g.done);

    const OrderCard = ({ group }: { group: OrderGroup }) => {
      const sample = group.items[0];
      const accent = sample ? getFulfillmentAccent(sample) : null;

      return (
      <div className={`bg-white rounded-xl border p-4 hover:shadow-md transition-all ${group.done ? 'border-green-200 opacity-70' : 'border-stone-200'} ${accent?.borderClass || ''}`}>
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={group.done}
            onChange={() => toggleOrderDone(group.orderId)}
            className="mt-1 w-5 h-5 rounded border-stone-300 text-[#C5A065] focus:ring-[#C5A065] cursor-pointer"
          />
          <div className="flex-1 min-w-0">
            {/* Header: numéro + heure cueillette */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-[#C5A065] uppercase tracking-wider">
                #{formatOrderNumber(group.orderNumber)}
              </span>
              <div className="flex items-center gap-2 text-stone-600 text-sm font-medium">
                {accent && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${accent.pillClass}`}>
                    {accent.label}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock size={13} />
                  <span className="font-semibold">
                    {group.deliveryType === "delivery" ? "Livraison" : "Ramassage"}: {group.deliveryTimeSlot || '—'}
                  </span>
                </span>
              </div>
            </div>

            {/* Produits */}
            <div className="space-y-1.5 mb-2">
              {group.items.map(item => {
                const itemAllergies = extractAllergies(item);
                return (
                  <div
                    key={item.id}
                    className={`text-sm ${group.done ? 'line-through text-stone-400' : 'text-[#2D2A26] font-medium'}`}
                  >
                    {/* Product name + qty + allergy on ONE inline row so the
                        kitchen sees at a glance which product an allergy
                        belongs to. The old layout put the allergy on the far
                        right via justify-between, which on wide cards put it
                        well away from its product name. */}
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span>{item.productName}</span>
                      <span
                        className={`shrink-0 text-base font-bold tabular-nums ${
                          group.done ? "text-stone-400" : "text-[#337957]"
                        }`}
                      >
                        × {item.quantity}
                      </span>
                      {itemAllergies && (
                        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-50 rounded text-[11px] text-red-700 border border-red-200 font-bold">
                          ⚠️ {itemAllergies}
                        </span>
                      )}
                    </div>
                    {Object.keys(item.selectedOptions || {}).some((k) => !isAllergyOptionName(k) && String(item.selectedOptions?.[k] || "").trim()) && (
                      <div className={`mt-0.5 ml-3 text-[12px] ${group.done ? "text-stone-400" : "text-stone-600"} font-normal`}>
                        {Object.entries(item.selectedOptions || {})
                          .filter(([k, v]) => !isAllergyOptionName(k) && String(v || "").trim())
                          .map(([k, v]) => `${k}: ${String(v).trim()}`)
                          .join(" \u2022 ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
    };

    return (
      <div className="space-y-4">
        {/* Bouton tri par heure de cueillette */}
        <div className="flex justify-end">
          <button
            onClick={() => setSortByPickupTime(s => !s)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              sortByPickupTime
                ? 'bg-[#C5A065] text-white border-[#C5A065]'
                : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
            }`}
          >
            <ArrowUpDown size={14} />
            Trier par heure de cueillette
          </button>
        </div>

        {notDoneOrders.length > 0 && (
          <div>
            <h3 className="text-lg font-bold text-amber-700 mb-3">Non Fait ({notDoneOrders.length})</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {notDoneOrders.map(group => (
                <OrderCard key={group.orderId} group={group} />
              ))}
            </div>
          </div>
        )}

        {doneOrders.length > 0 && (
          <div>
            <h3 className="text-lg font-bold text-green-700 mb-3">Fait ({doneOrders.length})</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {doneOrders.map(group => (
                <OrderCard key={group.orderId} group={group} />
              ))}
            </div>
          </div>
        )}

        {filteredOrders.length === 0 && (
          <div className="bg-stone-50 rounded-2xl p-12 text-center border border-stone-200">
            <ChefHat size={48} className="mx-auto mb-4 text-stone-400" />
            <h3 className="text-xl font-serif text-stone-500 mb-2">
              Aucun article à produire
            </h3>
            <p className="text-stone-400">
              {searchTerm
                ? "Aucun résultat ne correspond à votre recherche"
                : "Toutes les commandes sont à jour pour cette date"}
            </p>
          </div>
        )}
      </div>
    );
  };

  const ListView = () => {
    // Dédupliquer les items par orderId + options dans chaque groupe produit.
    // Une même commande peut contenir le même produit avec des options
    // différentes (ex: 1× Boîte à lunch en Pita + 1× en Baguette) — il faut
    // garder ces deux lignes pour ne pas perdre la 2ème option en production.
    const uniqueItemsForGroup = (items: ProductionItem[]) => {
      const seen = new Set<string>();
      return items.filter((item) => {
        const orderKey = item.orderId || item.orderNumber;
        const opts = item.selectedOptions
          ? Object.entries(item.selectedOptions)
              .filter(([k]) => !isAllergyOptionName(k))
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => `${k}=${v}`)
              .join("|")
          : "";
        const key = `${orderKey}::${opts}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    // Trier les groupes par heure de cueillette min si actif
    const sortedGroups = sortByPickupTime
      ? [...filteredGroups].sort((a, b) => {
          const minA = a.items.map(i => i.deliveryTimeSlot).sort()[0] ?? '';
          const minB = b.items.map(i => i.deliveryTimeSlot).sort()[0] ?? '';
          return minA.localeCompare(minB);
        })
      : filteredGroups;

    return (
    <div className="space-y-6">
      {/* Bouton tri par heure de cueillette */}
      <div className="flex justify-end">
        <button
          onClick={() => setSortByPickupTime(s => !s)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            sortByPickupTime
              ? 'bg-[#C5A065] text-white border-[#C5A065]'
              : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
          }`}
        >
          <ArrowUpDown size={14} />
          Trier par heure de cueillette
        </button>
      </div>
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="text-left py-3 px-4 text-xs font-bold text-stone-400 uppercase tracking-wider">Produit</th>
              <th className="text-left py-3 px-4 text-xs font-bold text-stone-400 uppercase tracking-wider">Quantité totale</th>
              <th className="text-left py-3 px-4 text-xs font-bold text-stone-400 uppercase tracking-wider">Allergies</th>
              <th className="text-left py-3 px-4 text-xs font-bold text-stone-400 uppercase tracking-wider">Non fait / fait</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {sortedGroups.map(group => {
              const uniqueOrders = (() => {
                const sorted = sortByPickupTime
                  ? [...group.items].sort((a, b) => parseTimeSlotStartMinutes(a.deliveryTimeSlot) - parseTimeSlotStartMinutes(b.deliveryTimeSlot))
                  : group.items;
                return uniqueItemsForGroup(sorted);
              })();
              const totalCount = uniqueOrders.length;
              const fulfillmentCounts = uniqueOrders.reduce(
                (acc, item) => {
                  if (item.deliveryType === "delivery") acc.delivery += 1;
                  if (isMontrealPickup(item)) acc.montrealPickup += 1;
                  if (item.deliveryType === "pickup" && !isMontrealPickup(item)) acc.lavalPickup += 1;
                  return acc;
                },
                { delivery: 0, montrealPickup: 0, lavalPickup: 0 },
              );
              const optionLines = uniqueOrders
                .map((item) => {
                  const text = getNonAllergyOptionsText(item.selectedOptions);
                  if (!text) return null;
                  return `#${formatOrderNumber(item.orderNumber)}: ${text}`;
                })
                .filter(Boolean) as string[];
              const optionPreview = optionLines.slice(0, 3);
              // Aggregate option choices ACROSS the whole product group so the
              // kitchen sees at a glance "Pains: Baguette × 4, Pita × 2"
              // instead of having to mentally tally each order's option line.
              // Map<optionName, Map<optionValue, totalQty>>.
              const optionBreakdown = new Map<string, Map<string, number>>();
              uniqueOrders.forEach((item) => {
                const opts = item.selectedOptions || {};
                Object.entries(opts).forEach(([optName, optValue]) => {
                  if (isAllergyOptionName(optName)) return;
                  const value = String(optValue || "").trim();
                  if (!value) return;
                  if (!optionBreakdown.has(optName)) {
                    optionBreakdown.set(optName, new Map());
                  }
                  const valueMap = optionBreakdown.get(optName)!;
                  valueMap.set(value, (valueMap.get(value) || 0) + (item.quantity || 1));
                });
              });
              // Per-order allergy lines so each warning is tied to its order
              // number, not floating somewhere on the right of the row.
              const allergyLines = uniqueOrders
                .map((item) => {
                  const a = extractAllergies(item);
                  if (!a) return null;
                  return {
                    order: formatOrderNumber(item.orderNumber),
                    text: a,
                  };
                })
                .filter(Boolean) as { order: string; text: string }[];
              const timeLines = uniqueOrders.map((item, idx) => ({
                key: `${item.orderId || item.orderNumber}-${idx}`,
                order: formatOrderNumber(item.orderNumber),
                time: item.deliveryTimeSlot || "—",
                type: item.deliveryType === "delivery" ? "Livraison" : "Ramassage",
              }));
              
              return (
                <tr key={group.productId} className="hover:bg-stone-50/50 transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-medium text-[#2D2A26]">{group.productName}</div>
                    <div className="text-xs text-stone-400 mt-1 flex items-center gap-2">
                      <span>{totalCount} commande{totalCount > 1 ? 's' : ''}</span>
                      <span className="inline-flex items-center gap-1">
                        {fulfillmentCounts.montrealPickup > 0 && (
                          <span
                            className="w-2 h-2 rounded-full bg-blue-400"
                            title="Cueillette Montréal"
                          />
                        )}
                        {fulfillmentCounts.lavalPickup > 0 && (
                          <span
                            className="w-2 h-2 rounded-full bg-white border border-stone-300"
                            title="Cueillette Laval"
                          />
                        )}
                        {fulfillmentCounts.delivery > 0 && (
                          <span
                            className="w-2 h-2 rounded-full bg-yellow-400"
                            title="Livraison"
                          />
                        )}
                      </span>
                    </div>
                    {(fulfillmentCounts.montrealPickup > 0 || fulfillmentCounts.lavalPickup > 0 || fulfillmentCounts.delivery > 0) && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {fulfillmentCounts.montrealPickup > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border bg-blue-100 text-blue-900 border-blue-200">
                            Montréal: {fulfillmentCounts.montrealPickup}
                          </span>
                        )}
                        {fulfillmentCounts.lavalPickup > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border bg-white text-stone-700 border-stone-200">
                            Laval: {fulfillmentCounts.lavalPickup}
                          </span>
                        )}
                        {fulfillmentCounts.delivery > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border bg-yellow-100 text-yellow-900 border-yellow-200">
                            Livraison: {fulfillmentCounts.delivery}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Aggregate breakdown per option ("Pains: Baguette × 4,
                        Pita × 2") so the kitchen knows how many of each
                        variant to make without having to sum order-by-order. */}
                    {optionBreakdown.size > 0 && (
                      <div className="mt-2 text-[12px] text-stone-700">
                        <div className="font-bold text-[11px] uppercase tracking-wider text-stone-400 mb-1">
                          Répartition
                        </div>
                        {Array.from(optionBreakdown.entries()).map(([optName, valueMap]) => (
                          <div key={optName} className="mb-0.5">
                            <span className="font-semibold">{optName}:</span>{" "}
                            {Array.from(valueMap.entries())
                              .sort(([, a], [, b]) => b - a)
                              .map(([val, qty]) => (
                                <span
                                  key={val}
                                  className="inline-block mr-2 px-1.5 py-0.5 rounded bg-stone-100 text-stone-700"
                                >
                                  {val}{" "}
                                  <span className="font-bold text-[#337957]">× {qty}</span>
                                </span>
                              ))}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Per-order option detail (so staff can still trace
                        which order chose which option). Kept compact since
                        the répartition above answers the production question. */}
                    {optionLines.length > 0 && (
                      <div className="mt-2 text-[12px] text-stone-500">
                        <div className="font-bold text-[10px] uppercase tracking-wider text-stone-400 mb-1">
                          Par commande
                        </div>
                        <div className="space-y-0.5">
                          {optionPreview.map((line) => (
                            <div key={line} className="truncate" title={line}>
                              {line}
                            </div>
                          ))}
                          {optionLines.length > optionPreview.length && (
                            <div className="text-stone-400">
                              +{optionLines.length - optionPreview.length} autre(s)
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {/* Per-order allergies pinned next to their order # so
                        staff can't accidentally read "noix" as belonging to
                        the wrong row. */}
                    {allergyLines.length > 0 && (
                      <div className="mt-2 text-[12px]">
                        <div className="font-bold text-[10px] uppercase tracking-wider text-red-500 mb-1">
                          Allergies par commande
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {allergyLines.map((a, i) => (
                            <span
                              key={`${a.order}-${i}`}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-50 rounded text-red-700 border border-red-200 font-bold text-[11px]"
                              title={`#${a.order}: ${a.text}`}
                            >
                              <span className="text-red-500">#{a.order}</span>
                              <span>⚠️ {a.text}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {timeLines.length > 0 && (
                      <div className="mt-2 text-[12px] text-stone-700">
                        <div className="font-bold text-[11px] uppercase tracking-wider text-stone-400 mb-1">
                          Heures
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {timeLines.map((t) => (
                            <span
                              key={t.key}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] ${
                                t.type === "Livraison"
                                  ? "bg-yellow-50 text-yellow-900 border-yellow-200"
                                  : "bg-blue-50 text-blue-900 border-blue-200"
                              }`}
                              title={`${t.type} #${t.order}`}
                            >
                              <Clock size={11} />
                              <span className="font-semibold">#{t.order}</span>
                              <span>{t.time}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-lg font-bold text-[#C5A065]">
                      {group.totalQuantity}
                    </span>
                    <span className="text-xs text-stone-400 ml-1">unités</span>
                  </td>
                  <td className="py-3 px-4">
                    {group.allergies.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {group.allergies.map((allergy, idx) => (
                          <span 
                            key={idx}
                            className="px-2 py-0.5 bg-red-50 text-red-600 rounded-full text-xs border border-red-200"
                          >
                            ⚠️ {allergy}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-stone-400">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {/* En-tête avec les labels Non remis / Remis */}
                    <div className="flex items-center gap-4 mb-2 text-xs font-medium">
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-amber-500 rounded"></div>
                        <span>Non fait</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-green-500 rounded"></div>
                        <span>Fait</span>
                      </div>
                    </div>
                    
                    {/* Une seule case à cocher par produit */}
                    <div className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={group.items.every(i => i.done)}
                        onChange={() => toggleProductDone(group.productId)}
                        className="w-4 h-4 rounded border-stone-300 text-[#C5A065] focus:ring-[#C5A065]"
                      />
                      <span className="text-stone-700 font-medium">
                        {group.items.every(i => i.done) ? 'Fait' : 'Non fait'}
                      </span>
                    </div>
                    
                    {/* Indicateur global du groupe */}
                    <div className="mt-3 text-xs text-stone-500 border-t border-stone-100 pt-2">
                      {group.items.filter(i => i.done).length} sur {group.items.length} fait
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sortedGroups.length === 0 && (
        <div className="bg-stone-50 rounded-2xl p-12 text-center border border-stone-200">
          <Package size={48} className="mx-auto mb-4 text-stone-400" />
          <h3 className="text-xl font-serif text-stone-500 mb-2">
            Aucun produit à fabriquer
          </h3>
          <p className="text-stone-400">
            {searchTerm 
              ? "Aucun résultat ne correspond à votre recherche" 
              : "Toutes les commandes sont à jour pour cette date"}
          </p>
        </div>
      )}
    </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <ChefHat size={48} className="mx-auto mb-4 text-[#C5A065] animate-pulse" />
          <p className="text-stone-500">Chargement de la liste de production...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto mb-4 text-red-400" />
          <p className="text-stone-600 mb-4">{error}</p>
          <button
            onClick={fetchProductionData}
            className="px-6 py-2 bg-[#C5A065] text-white rounded-lg hover:bg-[#b08a50] transition-colors"
          >
            <RefreshCw size={14} className="inline mr-2" />
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h2
              className="text-4xl md:text-5xl mb-2"
              style={{
                fontFamily: '"Great Vibes", cursive',
                color: "#C5A065",
              }}
            >
              Liste de Production
            </h2>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
              Gestion des articles à produire
            </p>
          </div>
          <div className="flex gap-2">
            {/* Toggle vue liste/commandes */}
            <div className="flex border border-stone-200 rounded-lg overflow-hidden mr-2">
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 transition-colors ${
                  viewMode === "list" 
                    ? "bg-[#C5A065] text-white" 
                    : "bg-white text-stone-600 hover:bg-stone-50"
                }`}
                title="Vue par produit"
              >
                <LayoutGrid size={20} />
              </button>
              <button
                onClick={() => setViewMode("orders")}
                className={`p-2 transition-colors ${
                  viewMode === "orders" 
                    ? "bg-[#C5A065] text-white" 
                    : "bg-white text-stone-600 hover:bg-stone-50"
                }`}
                title="Vue par commande"
              >
                <List size={20} />
              </button>
            </div>
            <button
              onClick={fetchProductionData}
              className="p-2 border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors"
              title="Rafraîchir"
            >
              <RefreshCw size={20} />
            </button>
            <button className="p-2 border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors">
              <Printer size={20} />
            </button>
            <button className="p-2 border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors">
              <Download size={20} />
            </button>
          </div>
        </div>
      </header>

      <div className="bg-white/70 backdrop-blur-md rounded-2xl p-4 mb-6 border border-white shadow-lg">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">
              Date de production
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C5A065]"
            />
          </div>

          <div className="flex-1">
            <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">
              Rechercher
            </label>
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={viewMode === "list" ? "Produit..." : "Produit, commande, client..."}
                className="w-full pl-10 pr-4 py-2 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C5A065]"
              />
            </div>
          </div>

          {viewMode === "orders" && (
            <div className="flex-1">
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">
                Statut
              </label>
              <select
                className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C5A065]"
              >
                <option value="all">Tous</option>
                <option value="notdone">Non remis</option>
                <option value="done">Remis</option>
              </select>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-stone-400 font-bold uppercase tracking-wider">Code couleur</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border bg-blue-100 text-blue-900 border-blue-200">
            Cueillette Montréal
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border bg-white text-stone-700 border-stone-200">
            Cueillette Laval
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border bg-yellow-100 text-yellow-900 border-yellow-200">
            Livraison
          </span>
        </div>
      </div>

      {/* Statistiques simplifiées */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-amber-50 rounded-xl p-3 border border-amber-200">
          <p className="text-xs text-amber-600 font-bold">Non Fait</p>
          <p className="text-2xl font-bold text-amber-700">
            {productionItems.filter(i => !i.done).length}
          </p>
        </div>
        <div className="bg-green-50 rounded-xl p-3 border border-green-200">
          <p className="text-xs text-green-600 font-bold">Fait</p>
          <p className="text-2xl font-bold text-green-700">
            {productionItems.filter(i => i.done).length}
          </p>
        </div>
      </div>



      {/* Affichage selon la vue */}
      {viewMode === "list" ? <ListView /> : <OrdersView />}
    </div>
  );
};

export default ProductionList;
