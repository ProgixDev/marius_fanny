import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { authClient, normalizedApiUrl } from "../lib/AuthClient";
import { authHeaders } from "../utils/authHeaders";
import { getSessionUniversal } from "../utils/getSession";
import { productAPI } from "../lib/ProductAPI";
import { categoryAPI } from "../lib/CategoryAPI";
import GoldenBackground from "./GoldenBackground";
import type { Product, Category } from "../types";
import {
  calculatePriceWithOptions,
  formatChoiceDisplay,
  getChoicePriceDeltaForOption,
} from "../utils/customOptions";
import {
  LogOut,
  Search,
  Package,
  ShoppingBag,
  Filter,
  Grid3X3,
  List,
  ChevronDown,
  ChevronUp,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Info,
  Briefcase,
  Menu,
} from "lucide-react";

const styles = {
  gold: "#C5A065",
  text: "#2D2A26",
  cream: "#F9F7F2",
  fontScript: '"Great Vibes", cursive',
  fontSans: '"Inter", sans-serif',
};

interface ProDashboardProps {
  onCartClick: () => void;
  cartCount: number;
  onAddToCart: (product: any) => void;
}

export default function ProDashboard({
  onCartClick,
  cartCount,
  onAddToCart,
}: ProDashboardProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showFilters, setShowFilters] = useState(false);
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | "available" | "unavailable">("all");
  const [sortBy, setSortBy] = useState<"name" | "price-asc" | "price-desc">("name");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [userName, setUserName] = useState("");
  const [activeView, setActiveView] = useState<"catalog" | "orders">("catalog");
  const [orderHistory, setOrderHistory] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [modalQuantity, setModalQuantity] = useState(1);
  const [modalSelectedOptions, setModalSelectedOptions] = useState<
    Record<string, string>
  >({});
  const [missingRequiredOptions, setMissingRequiredOptions] = useState<string[]>(
    [],
  );

  const navigate = useNavigate();

  const categoryList = (product: Product): string[] => {
    const value: any = (product as any).category;
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string" && value.trim()) return [value.trim()];
    return [];
  };
  const categoryText = (product: Product) => categoryList(product).join(", ");
  const primaryCategory = (product: Product) => categoryList(product)[0] || "";

  const normalizeOptionName = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const isAllergyOptionName = (name: string) =>
    normalizeOptionName(name).includes("allerg");
  const isClientNoteOptionName = (name: string) => {
    const normalized = normalizeOptionName(name);
    return (
      normalized.includes("note") ||
      normalized.includes("comment") ||
      normalized.includes("remarque")
    );
  };

  const computeMissingRequiredOptions = (
    product: Product | null,
    selected: Record<string, string>,
  ) => {
    if (!product?.customOptions?.length) return [] as string[];

    return product.customOptions
      .filter((option) => !isAllergyOptionName(option.name))
      .filter((option) => !isClientNoteOptionName(option.name))
      .filter((option) => !String(selected[option.name] || "").trim())
      .map((option) => option.name);
  };

  useEffect(() => {
    if (!selectedProduct) return;

    const initial: Record<string, string> = {};
    for (const option of selectedProduct.customOptions || []) {
      if (option.type === "text") {
        initial[option.name] = "";
      } else {
        initial[option.name] = option.choices?.[0] || "";
      }
    }

    setModalSelectedOptions(initial);
    setModalQuantity(Math.max(selectedProduct.minOrderQuantity || 1, 1));
    setMissingRequiredOptions(computeMissingRequiredOptions(selectedProduct, initial));
  }, [selectedProduct]);

  // Check auth & load data
  useEffect(() => {
    const init = async () => {
      try {
        const session = await getSessionUniversal();
        if (!session?.user) {
          setLoading(false);
          return;
        }
        const user: any = session.user;
        const role = user.role || user.user_metadata?.role;
        if (role !== "pro") {
          setLoading(false);
          return;
        }
        setUserName(user.name || "Partenaire");

        await fetchData();
      } catch {
        setLoading(false);
      }
    };
    init();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch all products (paginated - get all pages)
      let page = 1;
      let allProds: Product[] = [];
      let hasMore = true;

      while (hasMore) {
        const response = await productAPI.getAllProducts(page, 100, "pro");
        allProds = [...allProds, ...response.data.products];
        if (page >= response.data.pagination.totalPages) {
          hasMore = false;
        }
        page++;
      }

      setAllProducts(allProds);
      setProducts(allProds);

      // Fetch categories
      try {
        const catResponse = await categoryAPI.getAllCategories();
        setCategories(catResponse.data.categories || []);
      } catch {
        // Categories may not be set up, continue without them
      }
    } catch (error) {
      console.error("Failed to fetch products:", error);
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort products
  useEffect(() => {
    let filtered = [...allProducts];

    // Search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          categoryText(p).toLowerCase().includes(query) ||
          p.description?.toLowerCase().includes(query)
      );
    }

    // Category filter
    if (selectedCategory !== "all") {
      filtered = filtered.filter((p) => categoryList(p).includes(selectedCategory));
    }

    // Availability filter
    if (availabilityFilter === "available") {
      filtered = filtered.filter((p) => p.available);
    } else if (availabilityFilter === "unavailable") {
      filtered = filtered.filter((p) => !p.available);
    }

    // Sort
    if (sortBy === "name") {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "price-asc") {
      filtered.sort((a, b) => a.price - b.price);
    } else if (sortBy === "price-desc") {
      filtered.sort((a, b) => b.price - a.price);
    }

    setProducts(filtered);
  }, [searchQuery, selectedCategory, availabilityFilter, sortBy, allProducts]);

  const handleLogout = async () => {
    try {
      await authClient.signOut();
      navigate("/se-connecter");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const fetchMyProOrders = async () => {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const response = await fetch(`${normalizedApiUrl}/api/pro-orders/mine`, {
        headers: authHeaders(),
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || err?.message || `HTTP ${response.status}`);
      }
      const result = await response.json();
      setOrderHistory(result?.data?.orders || []);
    } catch (err: any) {
      setOrdersError(err?.message || "Impossible de charger l'historique.");
    } finally {
      setOrdersLoading(false);
    }
  };

  useEffect(() => {
    if (activeView === "orders") {
      fetchMyProOrders();
    }
  }, [activeView]);

  const handleModalOptionChange = (optionName: string, value: string) => {
    setModalSelectedOptions((prev) => {
      const next = { ...prev, [optionName]: value };
      setMissingRequiredOptions(computeMissingRequiredOptions(selectedProduct, next));
      return next;
    });
  };

  const currentModalPrice = selectedProduct
    ? calculatePriceWithOptions(
        selectedProduct.price,
        selectedProduct.customOptions || [],
        modalSelectedOptions,
      )
    : 0;

  // Get unique category names from products
  const productCategories = Array.from(
    new Set(allProducts.flatMap((p) => categoryList(p)).filter(Boolean))
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9F7F2]">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-[#C5A065] border-t-transparent rounded-full animate-spin" />
          <p className="text-stone-500 text-sm font-medium">
            Chargement du catalogue...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen bg-[#F9F7F2] font-sans text-stone-800">
      <div className="fixed inset-0 z-0 opacity-30">
        <GoldenBackground />
      </div>

      {/* MOBILE OVERLAY */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      <aside
        className={`
          fixed md:relative inset-y-0 left-0 z-50 md:z-20
          w-64 md:w-56 lg:w-72 max-w-[75vw] bg-white/80 backdrop-blur-md text-stone-800 flex flex-col shadow-2xl border-r border-stone-200/50
          transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
      >
        {/* Brand */}
        <div className="p-6 border-b border-stone-200/50 flex items-center justify-between">
          <div>
            <h1
              className="text-2xl mb-1"
              style={{ fontFamily: styles.fontScript, color: styles.gold }}
            >
              Marius & Fanny
            </h1>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
              Espace Partenaire
            </p>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden text-stone-400 hover:text-[#C5A065] transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* User Info */}
        <div className="p-4 border-b border-stone-200/50">
          <div className="flex items-center gap-3 p-3 bg-[#C5A065]/5 rounded-xl">
            <div className="w-10 h-10 rounded-full bg-[#C5A065] text-white flex items-center justify-center font-bold text-sm">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-sm text-stone-800">{userName}</p>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#C5A065]">
                Partenaire Pro
              </p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
          <div>
            <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.3em] mb-3 px-3">
              Commandes
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setActiveView("orders");
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-3 w-full p-3 rounded-xl transition-all duration-200 ${
                  activeView === "orders"
                    ? "bg-linear-to-r from-[#C5A065] to-[#b8935a] text-white shadow-lg shadow-[#C5A065]/30"
                    : "text-stone-600 hover:bg-stone-100 hover:text-[#C5A065]"
                }`}
              >
                <Clock size={20} />
                <span className="font-medium text-sm">Historique</span>
              </button>
            </div>
          </div>

          <div>
            <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.3em] mb-3 px-3">
              Catalogue
            </p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  setActiveView("catalog");
                  setSelectedCategory("all");
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-3 w-full p-3 rounded-xl transition-all duration-200 ${
                  selectedCategory === "all"
                    ? "bg-linear-to-r from-[#C5A065] to-[#b8935a] text-white shadow-lg shadow-[#C5A065]/30"
                    : "text-stone-600 hover:bg-stone-100 hover:text-[#C5A065]"
                }`}
              >
                <ShoppingBag size={20} />
                <span className="font-medium text-sm">Tous les produits</span>
                <span className="ml-auto text-xs opacity-70">
                  {allProducts.length}
                </span>
              </button>

              {productCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => {
                    setActiveView("catalog");
                    setSelectedCategory(cat);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`flex items-center gap-3 w-full p-3 rounded-xl transition-all duration-200 ${
                    selectedCategory === cat
                    ? "bg-linear-to-r from-[#C5A065] to-[#b8935a] text-white shadow-lg shadow-[#C5A065]/30"
                      : "text-stone-600 hover:bg-stone-100 hover:text-[#C5A065]"
                  }`}
                >
                  <Package size={20} />
                  <span className="font-medium text-sm">{cat}</span>
                  <span className="ml-auto text-xs opacity-70">
                    {allProducts.filter((p) => categoryList(p).includes(cat)).length}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </nav>

        {/* Back to site + Logout */}
        <div className="p-4 border-t border-stone-200/50 space-y-2">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-3 w-full p-3 rounded-xl text-stone-600 hover:bg-stone-100 hover:text-[#C5A065] transition-all border border-stone-200"
          >
            <Briefcase size={20} />
            <span className="font-medium text-sm">Retour au site</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full p-3 rounded-xl text-stone-600 hover:bg-red-50 hover:text-red-600 transition-all border border-stone-200 hover:border-red-200"
          >
            <LogOut size={20} />
            <span className="font-medium">Déconnexion</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
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
            style={{ fontFamily: styles.fontScript, color: styles.gold }}
          >
            Espace Pro
          </h1>
          <div className="w-8" />
        </div>

        {/* Header */}
        <header className="p-4 md:p-8 flex items-start justify-between gap-4">
          <div>
            <h2
              className="text-4xl md:text-5xl mb-2"
              style={{ fontFamily: styles.fontScript, color: styles.gold }}
            >
              {activeView === "orders" ? "Mes commandes" : "Catalogue Produits"}
            </h2>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
              {activeView === "orders"
                ? `${orderHistory.length} commande${orderHistory.length !== 1 ? "s" : ""}`
                : `${products.length} produit${products.length !== 1 ? "s" : ""} ${
                    selectedCategory !== "all" ? `dans ${selectedCategory}` : "disponibles"
                  }`}
            </p>
          </div>

          <button
            type="button"
            onClick={onCartClick}
            className="relative inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-stone-200 bg-white/70 backdrop-blur-md text-sm font-semibold text-stone-700 hover:text-[#C5A065] hover:border-[#C5A065] transition-colors"
            aria-label="Ouvrir le panier"
          >
            <ShoppingBag size={18} />
            Panier
            {cartCount > 0 && (
              <span className="absolute -top-2 -right-2 min-w-6 h-6 px-2 rounded-full bg-[#C5A065] text-white text-[10px] font-black flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>
        </header>

        {/* Search & Toolbar */}
        {activeView === "catalog" && (
        <div className="px-4 md:px-8 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher un produit..."
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-stone-200 bg-white/70 backdrop-blur-md focus:border-[#C5A065] focus:ring-2 focus:ring-[#C5A065]/20 outline-none text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-4 py-3 rounded-xl border border-stone-200 bg-white/70 backdrop-blur-md text-sm focus:border-[#C5A065] outline-none"
            >
              <option value="name">Trier par nom</option>
              <option value="price-asc">Prix croissant</option>
              <option value="price-desc">Prix décroissant</option>
            </select>

            {/* Availability Filter */}
            <select
              value={availabilityFilter}
              onChange={(e) => setAvailabilityFilter(e.target.value as any)}
              className="px-4 py-3 rounded-xl border border-stone-200 bg-white/70 backdrop-blur-md text-sm focus:border-[#C5A065] outline-none"
            >
              <option value="all">Tous</option>
              <option value="available">Disponibles</option>
              <option value="unavailable">Indisponibles</option>
            </select>

            {/* View toggle */}
            <div className="flex rounded-xl border border-stone-200 overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-3 transition-colors ${
                  viewMode === "grid"
                    ? "bg-[#C5A065] text-white"
                    : "bg-white/70 text-stone-500 hover:text-[#C5A065]"
                }`}
              >
                <Grid3X3 size={18} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-3 transition-colors ${
                  viewMode === "list"
                    ? "bg-[#C5A065] text-white"
                    : "bg-white/70 text-stone-500 hover:text-[#C5A065]"
                }`}
              >
                <List size={18} />
              </button>
            </div>
          </div>
        </div>
        )}

        {/* Products */}
        <div className="px-4 md:px-8 pb-8">
          {activeView === "orders" ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-stone-800">
                  Historique de commandes
                </h3>
                <button
                  type="button"
                  onClick={fetchMyProOrders}
                  className="px-4 py-2 rounded-xl border border-stone-200 bg-white/70 text-sm font-semibold text-stone-700 hover:text-[#C5A065] hover:border-[#C5A065] transition-colors"
                >
                  Rafraîchir
                </button>
              </div>

              {ordersLoading ? (
                <div className="bg-white/70 backdrop-blur-md rounded-2xl p-6 border border-stone-200 text-stone-600">
                  Chargement...
                </div>
              ) : ordersError ? (
                <div className="bg-red-50 rounded-2xl p-6 border border-red-200 text-red-700">
                  {ordersError}
                </div>
              ) : orderHistory.length === 0 ? (
                <div className="bg-white/70 backdrop-blur-md rounded-2xl p-6 border border-stone-200 text-stone-600">
                  Aucune commande pro pour le moment.
                </div>
              ) : (
                <div className="space-y-3">
                  {orderHistory.map((o: any) => (
                    <div
                      key={o._id || o.orderNumber}
                      className="bg-white/70 backdrop-blur-md rounded-2xl p-5 border border-stone-200"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-stone-400">
                            Commande pro
                          </div>
                          <div className="text-lg font-bold text-stone-800">
                            {o.orderNumber}
                          </div>
                          <div className="text-sm text-stone-600 mt-1">
                            {o.deliveryType === "delivery"
                              ? "Livraison"
                              : "Ramassage"}{" "}
                            •{" "}
                            {new Date(
                              o.createdAt || o.orderDate || Date.now(),
                            ).toLocaleString("fr-CA")}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-stone-400">
                            Total
                          </div>
                          <div className="text-xl font-bold text-[#C5A065]">
                            {Number(o.total || 0).toFixed(2)} $
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 rounded-xl border border-stone-200 bg-white/70 p-3">
                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-stone-400 mb-2">
                          Produits
                        </div>
                        {Array.isArray(o.items) && o.items.length > 0 ? (
                          <ul className="space-y-1 text-sm text-stone-700">
                            {o.items.map((item: any, idx: number) => (
                              <li key={`${o._id || o.orderNumber}-item-${idx}`}>
                                {item.productName || `Produit #${item.productId}`} × {Number(item.quantity || 0)}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-stone-500">Aucun produit trouvé pour cette commande.</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-16">
              <Package size={48} className="mx-auto text-stone-300 mb-4" />
              <p className="text-stone-500 text-lg">Aucun produit trouvé</p>
              <p className="text-stone-400 text-sm mt-1">
                Essayez de modifier vos filtres
              </p>
            </div>
          ) : viewMode === "grid" ? (
            /* GRID VIEW */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
              {products.map((product) => (
                <div
                  key={product.id}
                  onClick={() => setSelectedProduct(product)}
                  className="bg-white/70 backdrop-blur-md rounded-2xl shadow-lg border border-white hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden group"
                >
                  {/* Product image or placeholder */}
                  <div className="relative h-48 bg-linear-to-br from-[#C5A065]/10 to-[#C5A065]/5 flex items-center justify-center overflow-hidden">
                    {product.image ? (
                      <img
                        src={product.image}
                        alt={product.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <Package
                        size={48}
                        className="text-[#C5A065]/30"
                      />
                    )}
                    {/* Availability badge */}
                    <div className="absolute top-3 right-3">
                      {product.available ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                          <CheckCircle2 size={12} />
                          Disponible
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                          <XCircle size={12} />
                          Indisponible
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#C5A065] mb-1">
                      {primaryCategory(product)}
                    </p>
                    <h3 className="font-bold text-stone-800 mb-2 line-clamp-2">
                      {product.name}
                    </h3>
                    {product.description && (
                      <p className="text-xs text-stone-500 mb-3 line-clamp-2">
                        {product.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-bold text-[#C5A065]">
                        {product.price.toFixed(2)} $
                      </span>
                      {product.preparationTimeHours && (
                        <span className="inline-flex items-center gap-1 text-xs text-stone-400">
                          <Clock size={12} />
                          {product.preparationTimeHours}h
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* LIST VIEW */
            <div className="space-y-3">
              {products.map((product) => (
                <div
                  key={product.id}
                  onClick={() => setSelectedProduct(product)}
                  className="bg-white/70 backdrop-blur-md rounded-xl shadow-md border border-white hover:shadow-lg transition-all duration-200 cursor-pointer p-4 flex items-center gap-4"
                >
                  {/* Image */}
                  <div className="w-16 h-16 rounded-xl bg-linear-to-br from-[#C5A065]/10 to-[#C5A065]/5 flex items-center justify-center shrink-0 overflow-hidden">
                    {product.image ? (
                      <img
                        src={product.image}
                        alt={product.name}
                        className="w-full h-full object-cover rounded-xl"
                      />
                    ) : (
                      <Package size={24} className="text-[#C5A065]/30" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-stone-800 text-sm truncate">
                        {product.name}
                      </h3>
                      <span className="text-[8px] font-black uppercase tracking-widest text-[#C5A065] bg-[#C5A065]/10 px-2 py-0.5 rounded-full shrink-0">
                        {primaryCategory(product)}
                      </span>
                    </div>
                    {product.description && (
                      <p className="text-xs text-stone-500 truncate">
                        {product.description}
                      </p>
                    )}
                  </div>

                  {/* Price & Status */}
                  <div className="text-right shrink-0 flex items-center gap-4">
                    {product.preparationTimeHours && (
                      <span className="inline-flex items-center gap-1 text-xs text-stone-400">
                        <Clock size={12} />
                        {product.preparationTimeHours}h
                      </span>
                    )}
                    <span className="text-lg font-bold text-[#C5A065]">
                      {product.price.toFixed(2)} $
                    </span>
                    {product.available ? (
                      <CheckCircle2
                        size={20}
                        className="text-green-500"
                      />
                    ) : (
                      <XCircle size={20} className="text-red-400" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* PRODUCT DETAIL MODAL */}
      {selectedProduct && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedProduct(null)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Image */}
            <div className="relative h-56 bg-linear-to-br from-[#C5A065]/10 to-[#C5A065]/5 flex items-center justify-center overflow-hidden rounded-t-3xl">
              {selectedProduct.image ? (
                <img
                  src={selectedProduct.image}
                  alt={selectedProduct.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Package size={64} className="text-[#C5A065]/20" />
              )}
              <button
                onClick={() => setSelectedProduct(null)}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/80 backdrop-blur-md flex items-center justify-center text-stone-600 hover:text-stone-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6">
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#C5A065] mb-2">
                {categoryText(selectedProduct)}
              </p>
              <h2 className="text-2xl font-bold text-stone-800 mb-3">
                {selectedProduct.name}
              </h2>

              {selectedProduct.description && (
                <p className="text-stone-600 mb-4 text-sm leading-relaxed whitespace-pre-line">
                  {selectedProduct.description}
                </p>
              )}

              {/* Details */}
              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between py-2 border-b border-stone-100">
                  <span className="text-sm text-stone-500">Prix</span>
                  <span className="font-bold text-lg text-[#C5A065]">
                    {selectedProduct.price.toFixed(2)} $
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-stone-100">
                  <span className="text-sm text-stone-500">Disponibilité</span>
                  {selectedProduct.available ? (
                    <span className="inline-flex items-center gap-1.5 text-green-600 font-semibold text-sm">
                      <CheckCircle2 size={16} />
                      Disponible
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-red-500 font-semibold text-sm">
                      <XCircle size={16} />
                      Indisponible
                    </span>
                  )}
                </div>
                {selectedProduct.preparationTimeHours && (
                  <div className="flex items-center justify-between py-2 border-b border-stone-100">
                    <span className="text-sm text-stone-500">
                      Temps de préparation
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-stone-700 font-medium text-sm">
                      <Clock size={16} className="text-stone-400" />
                      {selectedProduct.preparationTimeHours}h
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between py-2 border-b border-stone-100">
                  <span className="text-sm text-stone-500">Quantité min.</span>
                  <span className="font-medium text-stone-700 text-sm">
                    {selectedProduct.minOrderQuantity}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-stone-100">
                  <span className="text-sm text-stone-500">Quantité max.</span>
                  <span className="font-medium text-stone-700 text-sm">
                    {selectedProduct.maxOrderQuantity}
                  </span>
                </div>
                {selectedProduct.allergens && (
                  <div className="flex items-center justify-between py-2 border-b border-stone-100">
                    <span className="text-sm text-stone-500">Allergènes</span>
                    <span className="font-medium text-stone-700 text-sm">
                      {selectedProduct.allergens}
                    </span>
                  </div>
                )}
                {selectedProduct.hasTaxes !== undefined && (
                  <div className="flex items-center justify-between py-2 border-b border-stone-100">
                    <span className="text-sm text-stone-500">Taxes</span>
                    <span className="font-medium text-stone-700 text-sm">
                      {selectedProduct.hasTaxes ? "Oui" : "Non"}
                    </span>
                  </div>
                )}
              </div>

              {/* Custom Options */}
              {selectedProduct.customOptions &&
                selectedProduct.customOptions.length > 0 && (
                  <div className="mb-6">
                    <h3 className="font-bold text-stone-800 text-sm mb-3">
                      Options personnalisées
                    </h3>
                    <div className="space-y-3">
                      {missingRequiredOptions.length > 0 && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                          Options requises manquantes :{" "}
                          {missingRequiredOptions.join(", ")}
                        </div>
                      )}

                      {selectedProduct.customOptions.map((opt, idx) => {
                        const currentValue = modalSelectedOptions[opt.name] || "";
                        const isOptional =
                          isAllergyOptionName(opt.name) ||
                          isClientNoteOptionName(opt.name);

                        return (
                          <div key={idx} className="p-3 bg-stone-50 rounded-xl">
                            <p className="text-xs font-bold text-stone-600 mb-2">
                              {opt.name}
                              {isOptional ? (
                                <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-stone-400">
                                  (optionnel)
                                </span>
                              ) : null}
                            </p>

                            {opt.type === "text" ? (
                              <input
                                value={currentValue}
                                onChange={(e) =>
                                  handleModalOptionChange(opt.name, e.target.value)
                                }
                                placeholder={`Entrer ${opt.name.toLowerCase()}...`}
                                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-sm focus:border-[#C5A065] outline-none"
                              />
                            ) : (
                              <div className="grid grid-cols-2 gap-2">
                                {opt.choices.map((choice) => {
                                  const displayText = formatChoiceDisplay(choice);
                                  const additionalPrice = getChoicePriceDeltaForOption(
                                    opt.choices || [],
                                    choice,
                                    selectedProduct.price,
                                  );
                                  const selected = currentValue === choice;
                                  return (
                                    <button
                                      key={`${opt.name}-${choice}`}
                                      type="button"
                                      onClick={() =>
                                        handleModalOptionChange(opt.name, choice)
                                      }
                                      className={`py-2 px-2 rounded-xl text-sm font-semibold transition-colors border ${
                                        selected
                                          ? "bg-[#C5A065] text-white border-[#C5A065]"
                                          : "bg-white text-stone-600 border-stone-200 hover:border-[#C5A065] hover:text-[#C5A065]"
                                      }`}
                                    >
                                      <div className="truncate">{displayText}</div>
                                      {additionalPrice > 0 && (
                                        <div className="text-[10px] opacity-80">
                                          +{additionalPrice.toFixed(2)}$
                                        </div>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              {/* Quantity + Add to cart */}
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <div className="text-xs font-black uppercase tracking-widest text-stone-400">
                    Prix
                  </div>
                  <div className="text-lg font-bold text-[#C5A065]">
                    {currentModalPrice.toFixed(2)} $
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setModalQuantity((q) =>
                        Math.max(selectedProduct.minOrderQuantity || 1, q - 1),
                      )
                    }
                    className="w-10 h-10 rounded-xl border border-stone-200 bg-white text-stone-700 hover:border-[#C5A065] hover:text-[#C5A065] transition-colors"
                    aria-label="Diminuer la quantité"
                  >
                    -
                  </button>
                  <div className="min-w-12 text-center font-bold text-stone-800">
                    {modalQuantity}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setModalQuantity((q) =>
                        Math.min(selectedProduct.maxOrderQuantity || 9999, q + 1),
                      )
                    }
                    className="w-10 h-10 rounded-xl border border-stone-200 bg-white text-stone-700 hover:border-[#C5A065] hover:text-[#C5A065] transition-colors"
                    aria-label="Augmenter la quantité"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedProduct(null)}
                  className="flex-1 py-3 rounded-xl border-2 border-stone-200 text-stone-600 font-bold text-sm uppercase tracking-widest hover:bg-stone-50 transition-colors"
                >
                  Fermer
                </button>
                <button
                  type="button"
                  disabled={!selectedProduct.available || missingRequiredOptions.length > 0}
                  onClick={() => {
                    if (!selectedProduct.available) return;
                    if (missingRequiredOptions.length > 0) return;

                    const payload = {
                      id: selectedProduct.id,
                      name: selectedProduct.name,
                      price: currentModalPrice,
                      image: selectedProduct.image || "",
                      selectedOptions: modalSelectedOptions,
                      hasTaxes: selectedProduct.hasTaxes,
                      category: (selectedProduct as any).category,
                      productionType: selectedProduct.productionType,
                      availableDays: selectedProduct.availableDays,
                    };

                    for (let i = 0; i < modalQuantity; i++) onAddToCart(payload);
                    setSelectedProduct(null);
                    onCartClick();
                  }}
                  className={`flex-1 py-3 rounded-xl font-bold text-sm uppercase tracking-widest transition-colors ${
                    !selectedProduct.available || missingRequiredOptions.length > 0
                      ? "bg-stone-300 text-stone-500 cursor-not-allowed"
                      : "bg-[#2D2A26] text-white hover:bg-[#C5A065]"
                  }`}
                >
                  Ajouter au panier
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
