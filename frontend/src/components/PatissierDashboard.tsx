import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChefHat,
  Package,
  ClipboardList,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Search,
  Printer,
  Download,
  RefreshCw,
  LayoutGrid,
  List,
  LogOut,
  Menu,
  X,
  MapPin,
  Phone,
  Truck,
  Clock
} from "lucide-react";
import { authClient } from "../lib/AuthClient";
import { dailyInventoryAPI, type DailyInventoryEntry } from "../lib/DailyInventoryAPI";
import GoldenBackground from "./GoldenBackground";
import ProductionList from "./ProductionList";

const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

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
  productionType?: "patisserie" | "cuisinier" | "four" | null;
  customerName: string;
  customerPhone: string;
  deliveryDate: string;
  deliveryTimeSlot: string;
  deliveryType: "pickup" | "delivery";
  pickupLocation: string;
  orderStatus: string;
  notes: string;
  done: boolean;
}

const isMontrealPickup = (item: Pick<ProductionItem, "deliveryType" | "pickupLocation">) => {
  if (item.deliveryType !== "pickup") return false;
  const location = (item.pickupLocation || "").toLowerCase();
  return location.includes("montreal") || location.includes("montr");
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
      label: "Montréal",
    };
  }

  return null;
};

interface GroupedProduct {
  productId: number;
  productName: string;
  totalQuantity: number;
  done: boolean;
  items: ProductionItem[];
}

interface InventorySummary {
  entries: DailyInventoryEntry[];
  updatedAt: string | null;
  savedBy: string | null;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function NavItem({ icon, label, active = false, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-3 w-full p-3 rounded-xl transition-all duration-200
        relative group
        ${
          active
            ? "bg-linear-to-r from-[#C5A065] to-[#b8935a] text-white shadow-lg shadow-[#C5A065]/30"
            : "text-stone-600 hover:bg-stone-100 hover:text-[#C5A065]"
        }
      `}
    >
      <span
        className={`${active ? "scale-110" : "group-hover:scale-110"} transition-transform`}
      >
        {icon}
      </span>
      <span className="font-medium text-sm">{label}</span>
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-[#C5A065] rounded-r-full" />
      )}
    </button>
  );
}

const PatissierDashboard: React.FC = () => {
  const [productionItems, setProductionItems] = useState<ProductionItem[]>([]);
  // done state per productId for the "Produits" view
  const [productDoneMap, setProductDoneMap] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDate, setSelectedDate] = useState<string>(
    getLocalDateYYYYMMDD()
  );
  const [viewMode, setViewMode] = useState<"list" | "orders">("list");
  const [activeModule, setActiveModule] = useState<"production" | "inventaire" | "inventaire-frais" | "livraisons">("production");
  const [deliveryOrders, setDeliveryOrders] = useState<any[]>([]);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(getLocalDateYYYYMMDD());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryJournalier, setInventoryJournalier] = useState<InventorySummary>({
    entries: [],
    updatedAt: null,
    savedBy: null,
  });
  const [inventoryFrais, setInventoryFrais] = useState<InventorySummary>({
    entries: [],
    updatedAt: null,
    savedBy: null,
  });
  const navigate = useNavigate();

  const loadSavedStatuses = (): { items: Record<string, boolean>; products: Record<number, boolean> } => {
    try {
      const saved = localStorage.getItem(`patissier-done-${selectedDate}`);
      return saved ? JSON.parse(saved) : { items: {}, products: {} };
    } catch { return { items: {}, products: {} }; }
  };

  const saveStatuses = (
    items: ProductionItem[],
    products: Record<number, boolean>
  ) => {
    const itemStatuses: Record<string, boolean> = {};
    items.forEach((item) => {
      if (item.done) itemStatuses[item.id] = true;
    });
    localStorage.setItem(
      `patissier-done-${selectedDate}`,
      JSON.stringify({ items: itemStatuses, products })
    );
  };

  useEffect(() => {
    fetchProductionData();
  }, [selectedDate]);

  useEffect(() => {
    fetchReadOnlyInventories();
  }, [selectedDate]);

  // Fetch delivery orders when the Livraisons module is opened or its date changes
  useEffect(() => {
    if (activeModule !== "livraisons") return;
    let cancelled = false;

    // Format a Date instance as YYYY-MM-DD in America/Toronto so a pickup
    // saved as "23:00 EDT" (which becomes 03:00 UTC the next day) still
    // matches the date the customer actually picked.
    const torontoDateStr = (input: any): string => {
      if (!input) return "";
      try {
        return new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Toronto",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(input));
      } catch {
        return "";
      }
    };

    const fetchWithFreshToken = async () => {
      const token = localStorage.getItem("bearer_token");
      const res = await fetch(
        `${API_URL}/api/orders?deliveryType=delivery&limit=500`,
        {
          credentials: "include",
          headers: token
            ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
            : { "Content-Type": "application/json" },
        },
      );
      // Capture any rotated bearer token from better-auth so the next call is fresh.
      const rotated = res.headers.get("set-auth-token");
      if (rotated) localStorage.setItem("bearer_token", rotated);
      return res;
    };

    const run = async () => {
      setDeliveryLoading(true);
      try {
        // limit=500 matches the bumped Zod cap on the backend.
        let res = await fetchWithFreshToken();
        // If the bearer token was stale, refresh the session once and retry —
        // avoids the "logout/login fixes it" pattern.
        if (res.status === 401) {
          try {
            const { getSessionUniversal } = await import("../utils/getSession");
            await getSessionUniversal();
            res = await fetchWithFreshToken();
          } catch {
            /* fall through */
          }
        }
        if (!res.ok) {
          if (!cancelled) setDeliveryOrders([]);
          return;
        }
        const json = await res.json();
        const items: any[] = json?.data?.items || [];
        const filtered = items.filter((o) => {
          // Belt-and-suspenders: only keep delivery orders even though the
          // backend was already supposed to filter on deliveryType=delivery.
          if (o.deliveryType !== "delivery") return false;
          // Prefer deliveryDate (already a YYYY-MM-DD string), fall back to
          // pickupDate which is an ISO string and needs Toronto-tz formatting.
          const candidate = (o.deliveryDate && String(o.deliveryDate).trim())
            ? String(o.deliveryDate).slice(0, 10)
            : torontoDateStr(o.pickupDate);
          return candidate === deliveryDate;
        });
        filtered.sort((a, b) =>
          String(a.deliveryTimeSlot || "").localeCompare(
            String(b.deliveryTimeSlot || ""),
          ),
        );
        if (!cancelled) setDeliveryOrders(filtered);
      } catch {
        if (!cancelled) setDeliveryOrders([]);
      } finally {
        if (!cancelled) setDeliveryLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [activeModule, deliveryDate]);

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

      if (response.status === 401 || !response.ok) {
        return;
      }

      const data = await response.json();
      const saved = loadSavedStatuses();

      const patissierItems = (data.data?.items || [])
        .filter((item: ProductionItem) => item.productionType === "patisserie")
        .map((item: ProductionItem) => ({
          ...item,
          done: saved.items[item.id] || false,
        }));

      setProductionItems(patissierItems);
      setProductDoneMap(saved.products || {});
    } catch (err: any) {
      console.error("Error loading production data:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchReadOnlyInventories = async () => {
    setInventoryLoading(true);
    setInventoryError(null);

    try {
      const [journalierRes, fraisRes] = await Promise.all([
        dailyInventoryAPI.getByDate(selectedDate),
        dailyInventoryAPI.getByDate(`${selectedDate}__four`),
      ]);

      setInventoryJournalier({
        entries: journalierRes.data.entries || [],
        updatedAt: journalierRes.data.updatedAt,
        savedBy: journalierRes.data.savedBy,
      });

      setInventoryFrais({
        entries: fraisRes.data.entries || [],
        updatedAt: fraisRes.data.updatedAt,
        savedBy: fraisRes.data.savedBy,
      });
    } catch (err: any) {
      setInventoryError(err?.message || "Erreur de chargement des inventaires.");
    } finally {
      setInventoryLoading(false);
    }
  };

  // Toggle done for a whole product (Produits view)
  const toggleProductDone = (productId: number) => {
    setProductDoneMap((prev) => {
      const updated = { ...prev, [productId]: !prev[productId] };
      saveStatuses(productionItems, updated);
      return updated;
    });
  };

  // Toggle done for a single order item (Commandes view)
  const toggleItemDone = (itemId: string) => {
    setProductionItems((prev) => {
      const updated = prev.map((item) =>
        item.id === itemId ? { ...item, done: !item.done } : item
      );
      saveStatuses(updated, productDoneMap);
      return updated;
    });
  };

  const handleLogout = async () => {
    // Always clear local credentials and redirect, even if the network
    // call to /api/auth/sign-out times out (e.g. Vercel cold-start).
    // Otherwise the user gets stuck on the dashboard.
    try {
      await authClient.signOut();
    } catch (error) {
      console.error("Logout network call failed (continuing anyway):", error);
    }
    try {
      localStorage.removeItem("bearer_token");
    } catch {
      /* ignore */
    }
    navigate("/se-connecter");
  };

  // Group products — one entry per productId with total quantity
  const groupedProducts: GroupedProduct[] = Object.values(
    productionItems.reduce((acc, item) => {
      if (!acc[item.productId]) {
        acc[item.productId] = {
          productId: item.productId,
          productName: item.productName,
          totalQuantity: 0,
          done: false,
          items: [],
        };
      }
      acc[item.productId].totalQuantity += item.quantity;
      acc[item.productId].items.push(item);
      return acc;
    }, {} as Record<number, GroupedProduct>)
  ).map((g) => ({ ...g, done: productDoneMap[g.productId] || false }));

  const filteredProducts = groupedProducts.filter((product) =>
    product.productName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredItems = productionItems.filter((item) =>
    item.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.orderNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalProducts = groupedProducts.length;
  const completedProducts = groupedProducts.filter((p) => productDoneMap[p.productId]).length;
  const completionPercentage =
    totalProducts > 0 ? Math.round((completedProducts / totalProducts) * 100) : 0;

  const handlePrint = () => window.print();

  const handleExport = () => {
    const csvContent = [
      ["Produit", "Quantité Totale"],
      ...groupedProducts.map((p) => [p.productName, p.totalQuantity]),
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `production-patissier-${selectedDate}.csv`;
    a.click();
  };

  return (
    <div className="relative flex h-screen bg-[#F9F7F2] font-sans text-stone-800">
      <div className="fixed inset-0 z-0 opacity-30">
        <GoldenBackground />
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
        fixed md:relative inset-y-0 left-0 z-50 md:z-20
        w-64 md:w-56 lg:w-72 max-w-[75vw] bg-white/80 backdrop-blur-md text-stone-800 flex flex-col shadow-2xl border-r border-stone-200/50
        transform transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}
      >
        <div className="p-6 border-b border-stone-200/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1
                className="text-2xl mb-1"
                style={{ fontFamily: '"Great Vibes", cursive', color: "#C5A065" }}
              >
                Marius & Fanny
              </h1>
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
                Pâtissier
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden text-stone-400 hover:text-[#C5A065] transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
          <div className="pb-4">
            <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.3em] mb-3 px-3">
              Production
            </p>
            <div className="space-y-2">
              <NavItem
                icon={<ChefHat size={20} />}
                label="Liste de production"
                active={activeModule === "production"}
                onClick={() => {
                  setActiveModule("production");
                  setIsMobileMenuOpen(false);
                }}
              />
              <NavItem
                icon={<ClipboardList size={20} />}
                label="Inventaire journalier"
                active={activeModule === "inventaire"}
                onClick={() => {
                  setActiveModule("inventaire");
                  setIsMobileMenuOpen(false);
                }}
              />
              <NavItem
                icon={<ClipboardList size={20} />}
                label="Inventaire Frais"
                active={activeModule === "inventaire-frais"}
                onClick={() => {
                  setActiveModule("inventaire-frais");
                  setIsMobileMenuOpen(false);
                }}
              />
              <NavItem
                icon={<Truck size={20} />}
                label="Livraisons"
                active={activeModule === "livraisons"}
                onClick={() => {
                  setActiveModule("livraisons");
                  setIsMobileMenuOpen(false);
                }}
              />
            </div>
          </div>
        </nav>

        <div className="p-4 border-t border-stone-200/50">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full p-3 rounded-xl text-stone-600 hover:bg-red-50 hover:text-red-600 transition-all border border-stone-200 hover:border-red-200"
          >
            <LogOut size={20} />
            <span className="font-medium">Déconnexion</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto relative z-10">
        {/* Mobile Header */}
        <div className="md:hidden bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="text-stone-600 hover:text-[#C5A065] p-2 -ml-2"
          >
            <Menu size={28} />
          </button>
          <h1
            className="text-2xl"
            style={{ fontFamily: '"Great Vibes", cursive', color: "#C5A065" }}
          >
            Marius & Fanny
          </h1>
          <div className="w-6" />
        </div>

        {activeModule === "production" && (
          <ProductionList filterByType="patisserie" />
        )}

        {activeModule === "livraisons" && (
          <div className="p-4 md:p-8 space-y-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <h2
                  className="text-4xl md:text-5xl mb-1"
                  style={{ fontFamily: '"Great Vibes", cursive', color: "#C5A065" }}
                >
                  Livraisons du jour
                </h2>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-stone-500">
                  Lecture seule — pour anticiper l'emballage
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Calendar size={18} className="text-stone-500" />
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
                />
              </div>
            </div>

            {deliveryLoading ? (
              <div className="bg-white rounded-2xl p-12 text-center border border-stone-200">
                <RefreshCw className="w-6 h-6 mx-auto mb-3 text-[#C5A065] animate-spin" />
                <p className="text-stone-500 text-sm">Chargement des livraisons…</p>
              </div>
            ) : deliveryOrders.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center border border-stone-200">
                <Truck size={48} className="mx-auto mb-4 text-stone-400" />
                <h3 className="text-xl font-serif text-stone-500 mb-2">
                  Aucune livraison ce jour
                </h3>
                <p className="text-stone-400 text-sm">
                  Aucune commande à livrer pour le {deliveryDate}.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {deliveryOrders.map((order) => {
                  const orderShort = String(order.orderNumber || "").split("-").pop() || order.orderNumber;
                  const addr = order.deliveryAddress || {};
                  const itemsCount = (order.items || []).reduce(
                    (s: number, it: any) => s + (it.quantity || 0),
                    0,
                  );
                  return (
                    <div
                      key={order._id || order.id}
                      className="bg-white rounded-xl border border-stone-200 border-l-4 border-l-yellow-400 p-4 hover:shadow-md transition-all"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="text-xs font-bold text-[#C5A065] uppercase tracking-wider">
                            #{orderShort}
                          </div>
                          <div className="font-semibold text-[#2D2A26]">
                            {order.clientInfo?.firstName} {order.clientInfo?.lastName}
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border bg-yellow-100 text-yellow-900 border-yellow-200">
                          <Clock size={11} />
                          {order.deliveryTimeSlot || "—"}
                        </span>
                      </div>

                      <div className="space-y-1.5 text-sm text-stone-700">
                        <div className="flex items-start gap-2">
                          <MapPin size={14} className="text-stone-400 mt-0.5 shrink-0" />
                          <span>
                            {[addr.street, addr.city, addr.postalCode]
                              .filter(Boolean)
                              .join(", ") || "Adresse non renseignée"}
                          </span>
                        </div>
                        {order.clientInfo?.phone && (
                          <div className="flex items-center gap-2 text-stone-600">
                            <Phone size={14} className="text-stone-400" />
                            <span>{order.clientInfo.phone}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-stone-600 pt-2 border-t border-stone-100">
                          <Package size={14} className="text-stone-400" />
                          <span>
                            {itemsCount} article{itemsCount > 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>

                      {(order.items || []).length > 0 && (
                        <div className="mt-3 pt-3 border-t border-stone-100">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-1">
                            Contenu
                          </div>
                          <ul className="text-xs text-stone-700 space-y-0.5">
                            {(order.items || []).slice(0, 6).map((it: any, idx: number) => (
                              <li key={idx} className="truncate">
                                {it.quantity}× {it.productName || `Produit #${it.productId}`}
                              </li>
                            ))}
                            {(order.items || []).length > 6 && (
                              <li className="text-stone-400">
                                +{(order.items || []).length - 6} autre(s)…
                              </li>
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {false && (
          <div className="p-4 md:p-8">
          {/* Old production - replaced by ProductionList */}
          <div className="bg-white/80 backdrop-blur-md rounded-lg shadow-sm p-6 mb-6 border border-stone-200/50">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <ChefHat className="w-8 h-8 text-[#C5A065]" />
                <div>
                  <h2
                    className="text-3xl md:text-4xl mb-1"
                    style={{ fontFamily: '"Great Vibes", cursive', color: "#C5A065" }}
                  >
                    Liste de Production - Pâtisserie
                  </h2>
                  <p className="text-stone-600">Gestion des pâtisseries</p>
                </div>
              </div>
              <div className="flex items-center gap-2 print:hidden">
                <button onClick={handlePrint} className="p-2 text-stone-600 hover:bg-stone-100 rounded-lg" title="Imprimer">
                  <Printer className="w-5 h-5" />
                </button>
                <button onClick={handleExport} className="p-2 text-stone-600 hover:bg-stone-100 rounded-lg" title="Exporter CSV">
                  <Download className="w-5 h-5" />
                </button>
                <button onClick={fetchProductionData} className="p-2 text-stone-600 hover:bg-stone-100 rounded-lg" title="Actualiser">
                  <RefreshCw className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Stats — 3 cards (Quantité Totale removed) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-amber-50 rounded-lg p-4 border border-amber-200/50">
                <div className="flex items-center gap-3">
                  <Package className="w-6 h-6 text-amber-600" />
                  <div>
                    <p className="text-sm text-stone-600">Total Produits</p>
                    <p className="text-2xl font-bold text-stone-900">{totalProducts}</p>
                  </div>
                </div>
              </div>
              <div className="bg-green-50 rounded-lg p-4 border border-green-200/50">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                  <div>
                    <p className="text-sm text-stone-600">Complété</p>
                    <p className="text-2xl font-bold text-stone-900">
                      {completedProducts}/{totalProducts}
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-purple-50 rounded-lg p-4 border border-purple-200/50">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-6 h-6 text-purple-600" />
                  <div>
                    <p className="text-sm text-stone-600">Progression</p>
                    <p className="text-2xl font-bold text-stone-900">{completionPercentage}%</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-4 print:hidden">
              <div className="flex-1 min-w-50">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
                  <input
                    type="text"
                    placeholder="Rechercher..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-[#C5A065] focus:border-transparent"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-stone-400" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-[#C5A065] focus:border-transparent"
                />
              </div>
              <div className="flex bg-stone-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode("list")}
                  className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                    viewMode === "list" ? "bg-white shadow-sm text-[#C5A065]" : "text-stone-600"
                  }`}
                >
                  <LayoutGrid className="w-4 h-4" />
                  Produits
                </button>
                <button
                  onClick={() => setViewMode("orders")}
                  className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                    viewMode === "orders" ? "bg-white shadow-sm text-[#C5A065]" : "text-stone-600"
                  }`}
                >
                  <List className="w-4 h-4" />
                  Commandes
                </button>
              </div>
            </div>
          </div>

          {/* ── VUE PRODUITS ── simple list: product + quantity + single checkbox */}
          {viewMode === "list" ? (
            <div className="bg-white/80 backdrop-blur-md rounded-lg shadow-sm border border-stone-200/50 overflow-hidden">
              {filteredProducts.length === 0 ? (
                <div className="p-8 text-center">
                  <Package className="w-12 h-12 text-stone-400 mx-auto mb-4" />
                  <p className="text-stone-600">Aucun produit à produire pour cette date</p>
                </div>
              ) : (
                <>
                  {/* Column headers */}
                  <div className="flex items-center gap-4 px-6 py-3 bg-stone-50 border-b border-stone-200">
                    <div className="w-7 shrink-0" />
                    <span className="flex-1 text-xs font-black uppercase tracking-widest text-stone-400">
                      Produit
                    </span>
                    <span className="shrink-0 text-xs font-black uppercase tracking-widest text-stone-400 min-w-12 text-right">
                      Quantité
                    </span>
                  </div>
                  <ul className="divide-y divide-stone-100">
                  {filteredProducts.map((product) => (
                    <li
                      key={product.productId}
                      className={`flex items-center gap-4 px-6 py-4 transition-colors ${
                        product.done ? "bg-green-50" : "hover:bg-stone-50"
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleProductDone(product.productId)}
                        className="shrink-0"
                        title="Marquer comme fait"
                      >
                        {product.done ? (
                          <CheckCircle2 className="w-7 h-7 text-green-500" />
                        ) : (
                          <div className="w-7 h-7 border-2 border-stone-300 rounded-full hover:border-[#C5A065] transition-colors" />
                        )}
                      </button>

                      {/* Product name */}
                      <span
                        className={`flex-1 text-lg font-semibold ${
                          product.done ? "line-through text-stone-400" : "text-stone-900"
                        }`}
                      >
                        {product.productName}
                      </span>

                      {/* Quantity badge */}
                      <span
                        className={`shrink-0 text-2xl font-bold min-w-12 text-right ${
                          product.done ? "text-green-400" : "text-[#C5A065]"
                        }`}
                      >
                        {product.totalQuantity}
                        <span className="text-sm font-normal text-stone-400 ml-1">u.</span>
                      </span>
                    </li>
                  ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            /* ── VUE COMMANDES ── detail per order item */
            <div className="space-y-4">
              {filteredItems.length === 0 ? (
                <div className="bg-white/80 backdrop-blur-md rounded-lg shadow-sm p-8 text-center border border-stone-200/50">
                  <Package className="w-12 h-12 text-stone-400 mx-auto mb-4" />
                  <p className="text-stone-600">Aucune commande pour cette date</p>
                </div>
              ) : (
                filteredItems.map((item) => {
                  const accent = getFulfillmentAccent(item);

                  return (
                  <div
                    key={item.id}
                    className={`bg-white/80 backdrop-blur-md rounded-lg shadow-sm p-6 border border-stone-200/50 ${
                      item.done ? "border-l-4 border-l-green-500" : (accent?.borderClass || "")
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <button onClick={() => toggleItemDone(item.id)} className="shrink-0 mt-1">
                        {item.done ? (
                          <CheckCircle2 className="w-6 h-6 text-green-600" />
                        ) : (
                          <div className="w-6 h-6 border-2 border-stone-300 rounded-full" />
                        )}
                      </button>
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-semibold text-stone-900">{item.productName}</h3>
                            <p className="text-sm text-stone-600">Commande #{item.orderNumber}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-bold text-[#C5A065]">{item.quantity}</p>
                            <p className="text-sm text-stone-600">unités</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-stone-400" />
                            <div>
                              <p className="text-sm text-stone-600">Client</p>
                              <p className="font-medium">{item.customerName}</p>
                              <p className="text-sm text-stone-500">{item.customerPhone}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-stone-400" />
                            <div>
                              <p className="text-sm text-stone-600">Livraison</p>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium">
                                  {item.deliveryType === "pickup" ? "Ramassage" : "Livraison"}
                                </p>
                                {accent && (
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${accent.pillClass}`}>
                                    {accent.label}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-stone-500">
                                {item.deliveryDate} - {item.deliveryTimeSlot}
                              </p>
                            </div>
                          </div>
                        </div>
                        {item.notes && (
                          <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                            <p className="text-sm font-medium text-stone-900 mb-1">Notes :</p>
                            <p className="text-sm text-stone-700">{item.notes}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          )}
          </div>
        )}

        {(activeModule === "inventaire" || activeModule === "inventaire-frais") && (
          <div className="p-4 md:p-8">
            <div className="bg-white/80 backdrop-blur-md rounded-lg shadow-sm p-6 mb-6 border border-stone-200/50">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <ClipboardList className="w-7 h-7 text-[#C5A065]" />
                  <div>
                    <h2
                      className="text-3xl md:text-4xl mb-1"
                      style={{ fontFamily: '"Great Vibes", cursive', color: "#C5A065" }}
                    >
                      {activeModule === "inventaire" ? "Inventaire Journalier" : "Inventaire Frais"}
                    </h2>
                    <p className="text-stone-600">Lecture seule - valeurs remplies par l'administrateur</p>
                  </div>
                </div>
                <button
                  onClick={fetchReadOnlyInventories}
                  className="p-2 text-stone-600 hover:bg-stone-100 rounded-lg"
                  title="Actualiser"
                >
                  <RefreshCw className={`w-5 h-5 ${inventoryLoading ? "animate-spin" : ""}`} />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-stone-400" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-[#C5A065] focus:border-transparent"
                />
              </div>
            </div>

            {inventoryError && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
                {inventoryError}
              </div>
            )}

            <div className="bg-white/80 backdrop-blur-md rounded-lg shadow-sm border border-stone-200/50 overflow-hidden">
              {(() => {
                const source = activeModule === "inventaire" ? inventoryJournalier : inventoryFrais;
                if (inventoryLoading) {
                  return (
                    <div className="p-8 text-center text-stone-600">
                      <RefreshCw className="w-7 h-7 animate-spin mx-auto mb-3 text-[#C5A065]" />
                      Chargement de l'inventaire...
                    </div>
                  );
                }

                if (!source.entries.length) {
                  return (
                    <div className="p-8 text-center text-stone-600">
                      Aucun inventaire saisi pour cette date.
                    </div>
                  );
                }

                const colTotals = source.entries.reduce(
                  (acc, entry) => {
                    acc.stock_stdo += entry.stock_stdo || 0;
                    acc.stdo += entry.stdo || 0;
                    acc.berri += entry.berri || 0;
                    acc.comm_berri += entry.comm_berri || 0;
                    acc.client += entry.client || 0;
                    acc.total += entry.total || 0;
                    return acc;
                  },
                  { stock_stdo: 0, stdo: 0, berri: 0, comm_berri: 0, client: 0, total: 0 }
                );

                return (
                  <>
                    <div className="px-6 py-3 bg-stone-50 border-b border-stone-200 text-sm text-stone-600">
                      Derniere mise a jour: {source.updatedAt ? new Date(source.updatedAt).toLocaleString("fr-CA") : "-"}
                      {source.savedBy ? `  -  par ${source.savedBy}` : ""}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left min-w-[450px]">
                        <thead className="bg-stone-50 border-b border-stone-200">
                          <tr className="text-[10px] uppercase tracking-widest text-stone-500">
                            <th className="px-2 md:px-6 py-3">Produit</th>
                            <th className="px-2 md:px-4 py-3 text-center">ST-do</th>
                            <th className="px-2 md:px-4 py-3 text-center">Comm. St-do</th>
                            <th className="px-2 md:px-4 py-3 text-center">BERRI</th>
                            <th className="px-2 md:px-4 py-3 text-center">Comm Berri</th>
                            <th className="px-2 md:px-4 py-3 text-center">Comm CLIENT</th>
                            <th className="px-2 md:px-4 py-3 text-center">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {source.entries.map((entry) => (
                            <tr key={entry.productId} className="hover:bg-stone-50/60">
                              <td className="px-6 py-3 font-medium text-stone-800">{entry.productName}</td>
                              <td className="px-4 py-3 text-center">{entry.stock_stdo || 0}</td>
                              <td className="px-4 py-3 text-center">{entry.stdo || 0}</td>
                              <td className="px-4 py-3 text-center">{entry.berri || 0}</td>
                              <td className="px-4 py-3 text-center">{entry.comm_berri || 0}</td>
                              <td className="px-4 py-3 text-center">{entry.client || 0}</td>
                              <td className="px-4 py-3 text-center font-semibold text-[#C5A065]">{entry.total || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-stone-50 border-t border-stone-200">
                          <tr className="font-semibold text-stone-700">
                            <td className="px-6 py-3">Totaux</td>
                            <td className="px-4 py-3 text-center">{colTotals.stock_stdo}</td>
                            <td className="px-4 py-3 text-center">{colTotals.stdo}</td>
                            <td className="px-4 py-3 text-center">{colTotals.berri}</td>
                            <td className="px-4 py-3 text-center">{colTotals.comm_berri}</td>
                            <td className="px-4 py-3 text-center">{colTotals.client}</td>
                            <td className="px-4 py-3 text-center text-[#C5A065]">{colTotals.total}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default PatissierDashboard;
