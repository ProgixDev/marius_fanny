import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { productAPI } from "../lib/ProductAPI";
import { orderAPI } from "../lib/OrderAPI";
import { normalizedApiUrl } from "../lib/AuthClient";
import {
  Package,
  LayoutDashboard,
  LogOut,
  Settings,
  X,
  Menu,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Users,
  UserCircle,
  ClipboardList,
  Truck,
  ChefHat,
  Clock,
  TicketPercent,
  FileText,
  Eye,
} from "lucide-react";
import StaffManagement from "./StaffManagement";
import ClientManagement from "./ClientManagement";
import { OrderManagement } from "./OrderManagement";
import { ProductManagement } from "./ProductManagement";
import { CategoryManagement } from "./CategoryManagement";
import SettingsManagement from "./SettingsManagement";
import DeliveryAssignment from "./DeliveryAssignment";
import QuoteManagement from "./QuoteManagement";
import ProductionList from "./ProductionList";
import InventaireJournalier from "./InventaireJournalier";
import PromoManagement from "./PromoManagement";
import { authClient } from "../lib/AuthClient";
import GoldenBackground from "./GoldenBackground";
import type { Product } from "../types";
import InventaireFrais from "./InventaireFour";
import Fermeture from "./Fermeture";

interface Statistics {
  totalProducts: number;
  totalRevenue: number;
  ordersToPrepare: number;
  totalSales: number;
  revenueChange: number;
  salesChange: number;
}

interface DashboardStats {
  totalRevenue: number;
  totalSales: number;
  revenueChange: number;
  salesChange: number;
  ordersToPrepare: number;
  topProducts: { name: string; quantity: number }[];
  recentActivity: {
    orderNumber: string;
    clientName: string;
    total: number;
    status: string;
    paymentStatus: string;
    createdAt: string;
  }[];
}

interface FormData {
  name: string;
  category: string;
  price: string;
  stock: string;
}

type ViewMode =
  | "overview"
  | "staff"
  | "clients"
  | "orders"
  | "products"
  | "promos"
  | "categories"
  | "quotes"
  | "settings"
  | "production"
  | "inventaire"
  | "inventaire-frais"
  | "fermeture";

const CATEGORIES = [
  "Gâteaux",
  "Pains",
  "Viennoiseries",
  "Chocolats",
  "Boîtes à lunch",
  "Salade repas",
  "Plateau repas",
  "Option végétarienne",
  "À la carte",
  "St-Valentin",
];

export default function AdminDashboard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({
    totalRevenue: 0,
    totalSales: 0,
    revenueChange: 0,
    salesChange: 0,
    ordersToPrepare: 0,
    topProducts: [],
    recentActivity: [],
  });
  const [visits, setVisits] = useState({ today: 0, thisMonth: 0, monthChange: 0 });
  const navigate = useNavigate();

  const gold = "#C5A065";
  const dark = "#2D2A26";

  useEffect(() => {
    fetchProducts();
    fetchStats();
    fetchVisits();
  }, []);

  const fetchStats = async () => {
    try {
      const res = await orderAPI.getStats();
      if (res?.data) setStats(res.data);
    } catch (error) {
      console.error("Failed to fetch dashboard stats:", error);
    }
  };

  const fetchVisits = async () => {
    try {
      const token = localStorage.getItem("bearer_token");
      const res = await fetch(`${normalizedApiUrl}/api/visits/stats`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      const json = await res.json();
      if (json?.data) setVisits(json.data);
    } catch (error) {
      console.error("Failed to fetch visit stats:", error);
    }
  };

  // "il y a X" lisible pour l'activité récente
  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `il y a ${h} h`;
    const d = Math.floor(h / 24);
    return `il y a ${d} j`;
  };

  const fetchProducts = async () => {
    try {
      setProductsLoading(true);
      const response = await productAPI.getAllProducts(1, 1000);
      setProducts(response.data.products);
    } catch (error) {
      console.error('Failed to fetch products:', error);
    } finally {
      setProductsLoading(false);
    }
  };

  // Check authentication on mount (silent - no redirect)
  useEffect(() => {
    const checkAuth = async () => {
      try {
        await authClient.getSession();
      } catch {
        // silently ignore auth errors
      }
    };
    checkAuth();
  }, []);

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


  const statistics: Statistics = {
    totalProducts: products.length,
    totalRevenue: stats.totalRevenue,
    ordersToPrepare: stats.ordersToPrepare,
    totalSales: stats.totalSales,
    revenueChange: stats.revenueChange,
    salesChange: stats.salesChange,
  };

  // Produits les plus vendus (vraies ventes du mois, depuis les commandes payées)
  const topProducts = stats.topProducts;

  return (
    <div className="relative flex h-screen bg-[#F9F7F2] font-sans text-stone-800">
      <div className="fixed inset-0 z-0 opacity-30">
        <GoldenBackground />
      </div>

      {/* --- MOBILE MENU OVERLAY --- */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* --- SIDEBAR --- */}
      <aside
        className={`
        fixed md:relative inset-y-0 left-0 z-50 md:z-20
        w-64 md:w-56 lg:w-72 max-w-[75vw] bg-white/80 backdrop-blur-md text-stone-800 flex flex-col shadow-2xl border-r border-stone-200/50
        transform transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}
      >
        {/* Brand Header */}
        <div className="p-6 border-b border-stone-200/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1
                className="text-2xl mb-1"
                style={{
                  fontFamily: '"Great Vibes", cursive',
                  color: "#C5A065",
                }}
              >
                Marius & Fanny
              </h1>
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
                Admin Panel
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

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
          {/* Main Section */}
          <div className="pb-4">
            <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.3em] mb-3 px-3">
              Principal
            </p>
            <div className="space-y-2">
              <NavItem
                icon={<LayoutDashboard size={20} />}
                label="Vue d'ensemble"
                active={viewMode === "overview"}
                onClick={() => {
                  setViewMode("overview");
                  setIsMobileMenuOpen(false);
                }}
              />
            </div>
          </div>

          {/* Production Section */}
          <div className="pb-4 border-t border-stone-200/50 pt-4">
            <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.3em] mb-3 px-3">
              Production
            </p>
            <div className="space-y-2">
              <NavItem
                icon={<ChefHat size={20} />}
                label="Liste de production"
                active={viewMode === "production"}
                onClick={() => {
                  setViewMode("production");
                  setIsMobileMenuOpen(false);
                }}
              />
              <NavItem
                icon={<ClipboardList size={20} />}
                label="Inventaire journalier"
                active={viewMode === "inventaire"}
                onClick={() => {
                  setViewMode("inventaire");
                  setIsMobileMenuOpen(false);
                }}
              />
              <NavItem
                icon={<ClipboardList size={20} />}
                label="Inventaire Frais"
                active={viewMode === "inventaire-frais"}
                onClick={() => {
                  setViewMode("inventaire-frais");
                  setIsMobileMenuOpen(false);
                }}
              />
              <NavItem
                icon={<ClipboardList size={20} />}
                label="Fermeture"
                active={viewMode === "fermeture"}
                onClick={() => {
                  setViewMode("fermeture");
                  setIsMobileMenuOpen(false);
                }}
              />
            </div>
          </div>

          {/* Management Section */}
          <div className="pb-4 border-t border-stone-200/50 pt-4">
            <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.3em] mb-3 px-3">
              Gestion
            </p>
            <div className="space-y-2">
              <NavItem
                icon={<Package size={20} />}
                label="Produits"
                active={viewMode === "products"}
                onClick={() => {
                  setViewMode("products");
                  setIsMobileMenuOpen(false);
                }}
              />
              <NavItem
                icon={<Package size={20} />}
                label="Catégories"
                active={viewMode === "categories"}
                onClick={() => {
                  setViewMode("categories");
                  setIsMobileMenuOpen(false);
                }}
              />
              <NavItem
                icon={<TicketPercent size={20} />}
                label="Codes promo"
                active={viewMode === "promos"}
                onClick={() => {
                  setViewMode("promos");
                  setIsMobileMenuOpen(false);
                }}
              />
              <NavItem
                icon={<ClipboardList size={20} />}
                label="Commandes"
                active={viewMode === "orders"}
                onClick={() => {
                  setViewMode("orders");
                  setIsMobileMenuOpen(false);
                }}
              />
              <NavItem
                icon={<Users size={20} />}
                label="Personnel"
                active={viewMode === "staff"}
                onClick={() => {
                  setViewMode("staff");
                  setIsMobileMenuOpen(false);
                }}
              />
              <NavItem
                icon={<UserCircle size={20} />}
                label="Clients"
                active={viewMode === "clients"}
                onClick={() => {
                  setViewMode("clients");
                  setIsMobileMenuOpen(false);
                }}
              />
              <NavItem
                icon={<FileText size={20} />}
                label="Soumissions"
                active={viewMode === "quotes"}
                onClick={() => {
                  setViewMode("quotes");
                  setIsMobileMenuOpen(false);
                }}
              />
            </div>
          </div>

          {/* Settings Section */}
          <div className="border-t border-stone-200/50 pt-4">
            <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.3em] mb-3 px-3">
              Système
            </p>
            <div className="space-y-2">
              <NavItem
                icon={<Settings size={20} />}
                label="Paramètres"
                active={viewMode === "settings"}
                onClick={() => {
                  setViewMode("settings");
                  setIsMobileMenuOpen(false);
                }}
              />
            </div>
          </div>
        </nav>

        {/* Logout */}
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

      {/* --- MAIN CONTENT --- */}
      <main className="flex-1 overflow-auto relative z-10">
        {/* Mobile Header with Hamburger */}
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
          <div className="w-8" />
        </div>

        {/* VUE D'ENSEMBLE */}
        {viewMode === "overview" && (
          <>
            <header className="p-5 md:p-8">
              <h2
                className="text-3xl sm:text-4xl md:text-5xl mb-2"
                style={{
                  fontFamily: '"Great Vibes", cursive',
                  color: "#C5A065",
                }}
              >
                Vue d'ensemble
              </h2>
              <p className="text-[10px] sm:text-[9px] font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] text-stone-500">
                Tableau de bord administrateur
              </p>
            </header>

            <div className="p-3 sm:p-4 md:p-8">
              {/* Stats Grid - Responsive */}
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-6 mb-6 md:mb-8">
                <StatCard
                  title="Visites aujourd'hui"
                  value={visits.today}
                  icon={<Eye size={24} />}
                  color="blue"
                />
                <StatCard
                  title="Visites ce mois"
                  value={visits.thisMonth}
                  change={visits.monthChange}
                  icon={<BarChart3 size={24} />}
                  color="purple"
                />
                <StatCard
                  title="Produits"
                  value={statistics.totalProducts}
                  icon={<Package size={24} />}
                  color="blue"
                />
                <StatCard
                  title="Chiffre d'affaires"
                  value={`${statistics.totalRevenue.toFixed(2)} $`}
                  change={statistics.revenueChange}
                  icon={<DollarSign size={24} />}
                  color="green"
                />
                <StatCard
                  title="Ventes totales"
                  value={statistics.totalSales}
                  change={statistics.salesChange}
                  icon={<ShoppingCart size={24} />}
                  color="purple"
                />
                <StatCard
                  title="Commandes à préparer"
                  value={statistics.ordersToPrepare}
                  icon={<ClipboardList size={24} />}
                  color="red"
                  alert={statistics.ordersToPrepare > 0}
                />
              </div>

              {/* Top Products & Charts - Responsive Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                {/* Top Products */}
                <div className="bg-white/70 backdrop-blur-md rounded-2xl sm:rounded-3xl shadow-xl border border-white p-4 sm:p-6 md:p-8 hover:shadow-2xl transition-all duration-300">
                  <div className="flex items-center justify-between mb-4 md:mb-6">
                    <h3 className="text-base sm:text-xl md:text-2xl font-bold text-stone-800">
                      Produits les plus vendus
                    </h3>
                    <BarChart3 className="text-[#C5A065]" size={24} />
                  </div>
                  <div className="space-y-3 md:space-y-4">
                    {topProducts.length === 0 ? (
                      <p className="text-sm text-gray-400">Aucune vente ce mois-ci pour l'instant.</p>
                    ) : (
                      topProducts.map((product, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-3 md:gap-4"
                        >
                          <div className="w-8 h-8 rounded-full bg-[#C5A065] text-white flex items-center justify-center font-bold text-sm shrink-0">
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-[#2D2A26] text-sm md:text-base truncate">
                              {product.name}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-bold text-[#2D2A26] text-sm md:text-base">
                              {product.quantity}
                            </p>
                            <p className="text-xs text-gray-500">vendus</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Recent Activity */}
                <div className="bg-white/70 backdrop-blur-md rounded-3xl shadow-xl border border-white p-6 md:p-8 hover:shadow-2xl transition-all duration-300">
                  <h3 className="text-xl md:text-2xl font-bold text-stone-800 mb-4 md:mb-6">
                    Activité récente
                  </h3>
                  <div className="space-y-3 md:space-y-4">
                    {stats.recentActivity.length === 0 ? (
                      <p className="text-sm text-gray-400">Aucune commande récente.</p>
                    ) : (
                      stats.recentActivity.map((act, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-3 pb-3 md:pb-4 border-b border-gray-100 last:border-0"
                        >
                          <div className="w-2 h-2 rounded-full bg-[#C5A065] mt-2 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm md:text-base text-[#2D2A26] font-medium">
                              Commande #{act.orderNumber} — {act.total.toFixed(2)} $
                            </p>
                            <p className="text-xs md:text-sm text-gray-500 truncate">
                              {act.clientName}
                              {act.paymentStatus === "paid" ? " · Payé" : " · Non payé"}
                            </p>
                          </div>
                          <span className="text-xs text-gray-400 shrink-0">
                            {timeAgo(act.createdAt)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* LISTE DE PRODUCTION */}
        {viewMode === "production" && <ProductionList />}

        {/* INVENTAIRE JOURNALIER */}
        {viewMode === "inventaire" && <InventaireJournalier />}
        {viewMode === "inventaire-frais" && <InventaireFrais />}
        {viewMode === "fermeture" && <Fermeture />} 
        {/* GESTION DU PERSONNEL */}
        {viewMode === "staff" && <StaffManagement />}

        {/* VUE CLIENTS */}
        {viewMode === "clients" && <ClientManagement />}

        {/* VUE COMMANDES */}
        {viewMode === "orders" && <OrderManagement />}

        {/* VUE PRODUITS */}
        {viewMode === "products" && <ProductManagement />}

        {/* VUE CODES PROMO */}
        {viewMode === "promos" && <PromoManagement products={products} />}

        {/* VUE CATÉGORIES */}
        {viewMode === "categories" && <CategoryManagement />}

        {/* VUE SOUMISSIONS */}
        {viewMode === "quotes" && <QuoteManagement />}

        {/* VUE PARAMÈTRES */}
        {viewMode === "settings" && (
          <div className="p-6">
            <SettingsManagement />
          </div>
        )}
      </main>
    </div>
  );
}

// --- Composants ---

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

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "En stock"
      ? "bg-green-100 text-green-700 border-green-200"
      : status === "Stock bas"
        ? "bg-orange-100 text-orange-700 border-orange-200"
        : "bg-red-100 text-red-700 border-red-200";

  return (
    <span
      className={`px-2 md:px-3 py-1 rounded-full text-xs font-semibold border ${styles} whitespace-nowrap`}
    >
      {status}
    </span>
  );
}

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
  color: "blue" | "green" | "purple" | "red";
  alert?: boolean;
}

function StatCard({ title, value, change, icon, color, alert }: StatCardProps) {
  const colorClasses = {
    blue: "bg-blue-100 text-blue-600",
    green: "bg-green-100 text-green-600",
    purple: "bg-purple-100 text-purple-600",
    red: "bg-red-100 text-red-600",
  };

  return (
    <div
      className={`bg-white/70 backdrop-blur-md rounded-2xl border border-white shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 p-4 sm:p-5 md:p-6 ${alert ? "ring-2 ring-red-300" : ""}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] sm:text-xs font-bold opacity-60 uppercase tracking-widest mb-1">
            {title}
          </p>
          <h3 className="text-lg sm:text-2xl md:text-3xl font-bold text-stone-800">
            {value}
          </h3>
          {change !== undefined && (
            <div className="flex items-center gap-1 mt-2">
              {change >= 0 ? (
                <TrendingUp size={14} className="text-green-600" />
              ) : (
                <TrendingDown size={14} className="text-red-600" />
              )}
              <span
                className={`text-xs md:text-sm font-bold ${change >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                {change >= 0 ? "+" : ""}
                {change}%
              </span>
              <span className="text-xs text-stone-400 hidden sm:inline">
                vs mois dernier
              </span>
            </div>
          )}
        </div>
        <div className={`p-2.5 rounded-lg ${colorClasses[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
