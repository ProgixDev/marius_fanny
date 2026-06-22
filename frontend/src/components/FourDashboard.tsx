import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Flame, 
  Package, 
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
  Phone
} from "lucide-react";
import { authClient } from "../lib/AuthClient";
import GoldenBackground from "./GoldenBackground";

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
            ? "bg-gradient-to-r from-[#C5A065] to-[#b8935a] text-white shadow-lg shadow-[#C5A065]/30"
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

const FourDashboard: React.FC = () => {
  const [productionItems, setProductionItems] = useState<ProductionItem[]>([]);
  const [productDoneMap, setProductDoneMap] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDate, setSelectedDate] = useState<string>(
    getLocalDateYYYYMMDD()
  );
  const [viewMode, setViewMode] = useState<"list" | "orders">("list");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const loadSavedStatuses = (): { items: Record<string, boolean>; products: Record<number, boolean> } => {
    try {
      const saved = localStorage.getItem(`four-done-${selectedDate}`);
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
      `four-done-${selectedDate}`,
      JSON.stringify({ items: itemStatuses, products })
    );
  };

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

      if (response.status === 401 || !response.ok) {
        return;
      }

      const data = await response.json();
      const saved = loadSavedStatuses();

      const fourItems = (data.data?.items || [])
        .filter((item: ProductionItem) => (item.productionType || "").toString().trim().toLowerCase() === "four")
        .map((item: ProductionItem) => ({
          ...item,
          done: saved.items[item.id] || false,
        }));

      setProductionItems(fourItems);
      setProductDoneMap(saved.products || {});
    } catch (err: any) {
      console.error("Error loading production data:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleProductDone = (productId: number) => {
    setProductDoneMap((prev) => {
      const updated = { ...prev, [productId]: !prev[productId] };
      saveStatuses(productionItems, updated);
      return updated;
    });
  };

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
    a.download = `production-four-${selectedDate}.csv`;
    a.click();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9F7F2]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-[#C5A065]" />
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9F7F2]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-900 font-semibold mb-2">Erreur</p>
          <p className="text-gray-600">{error}</p>
          <button
            onClick={fetchProductionData}
            className="mt-4 px-4 py-2 bg-[#C5A065] text-white rounded-lg hover:bg-[#b8935a]"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen bg-[#F9F7F2] font-sans text-stone-800">
      <div className="fixed inset-0 z-0 opacity-30">
        <GoldenBackground />
      </div>

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
          <div>
            <h1
              className="text-2xl mb-1"
              style={{ fontFamily: '"Great Vibes", cursive', color: "#C5A065" }}
            >
              Marius & Fanny
            </h1>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
              Four
            </p>
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
              <NavItem icon={<Flame size={20} />} label="Liste de production" active={true} />
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
        <div className="md:hidden bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
          <button onClick={() => setIsMobileMenuOpen(true)} className="text-stone-600 hover:text-[#C5A065] p-2 -ml-2">
            <Menu size={28} />
          </button>
          <h1 className="text-2xl" style={{ fontFamily: '"Great Vibes", cursive', color: "#C5A065" }}>
            Marius & Fanny
          </h1>
          <div className="w-8" />
        </div>

        <div className="p-4 md:p-8">
          {/* Header */}
          <div className="bg-white/80 backdrop-blur-md rounded-lg shadow-sm p-6 mb-6 border border-stone-200/50">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <Flame className="w-8 h-8 text-[#C5A065]" />
                <div>
                  <h2
                    className="text-3xl md:text-4xl mb-1"
                    style={{ fontFamily: '"Great Vibes", cursive', color: "#C5A065" }}
                  >
                    Liste de Production - Four
                  </h2>
                  <p className="text-stone-600">Gestion des produits à cuire au four</p>
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

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-orange-50 rounded-lg p-4 border border-orange-200/50">
                <div className="flex items-center gap-3">
                  <Package className="w-6 h-6 text-orange-600" />
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
              <div className="bg-red-50 rounded-lg p-4 border border-red-200/50">
                <div className="flex items-center gap-3">
                  <Flame className="w-6 h-6 text-red-600" />
                  <div>
                    <p className="text-sm text-stone-600">Progression</p>
                    <p className="text-2xl font-bold text-stone-900">{completionPercentage}%</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-4 print:hidden">
              <div className="flex-1 min-w-[140px] sm:min-w-[200px]">
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

          {/* ── VUE PRODUITS ── */}
          {viewMode === "list" ? (
            <div className="bg-white/80 backdrop-blur-md rounded-lg shadow-sm border border-stone-200/50 overflow-hidden">
              {filteredProducts.length === 0 ? (
                <div className="p-8 text-center">
                  <Package className="w-12 h-12 text-stone-400 mx-auto mb-4" />
                  <p className="text-stone-600">Aucun produit à produire pour cette date</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4 px-6 py-3 bg-stone-50 border-b border-stone-200">
                    <div className="w-7 shrink-0" />
                    <span className="flex-1 text-xs font-black uppercase tracking-widest text-stone-400">
                      Produit
                    </span>
                    <span className="shrink-0 text-xs font-black uppercase tracking-widest text-stone-400 min-w-[3rem] text-right">
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

                        <span
                          className={`flex-1 text-lg font-semibold ${
                            product.done ? "line-through text-stone-400" : "text-stone-900"
                          }`}
                        >
                          {product.productName}
                        </span>

                        <span
                          className={`shrink-0 text-2xl font-bold min-w-[3rem] text-right ${
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
            /* ── VUE COMMANDES ── */
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
      </main>
    </div>
  );
};

export default FourDashboard;
