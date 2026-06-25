import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package,
  Clock,
  MapPin,
  Phone,
  User,
  ChevronRight,
  LogOut,
  Menu,
  X,
  Calendar,
  Filter,
} from "lucide-react";
import { authClient, normalizedApiUrl } from "../lib/AuthClient";
import { authHeaders } from "../utils/authHeaders";
import { getSessionUniversal } from "../utils/getSession";
import { Modal } from "@/components/ui/modal";

const ENABLE_DELIVERY_MOCKS = import.meta.env.VITE_ENABLE_DELIVERY_MOCKS === "true";

// Types
interface DeliveryOrder {
  id: string;
  orderNumber: string;
  clientInfo: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
  };
  deliveryAddress: {
    street: string;
    city: string;
    postalCode: string;
    province: string;
  };
  status: "pending" | "in_transit" | "arrived" | "delivered";
  items: Array<{
    productName: string;
    quantity: number;
    price?: number;
  }>;
  totalAmount: number;
  estimatedDeliveryTime?: string;
  createdAt: string;
  paymentStatus?: "unpaid" | "deposit_paid" | "paid";
  assignedDriver?: {
    id: string;
    name: string;
    assignedAt?: string;
  };
}

// Mock Data - MIS À JOUR POUR 2026
const MOCK_DELIVERY_ORDERS: DeliveryOrder[] = [
  {
    id: "mock-001",
    orderNumber: "CMD-2026-001",
    clientInfo: {
      firstName: "Sophie",
      lastName: "Martin",
      phone: "514-555-0123",
      email: "sophie.martin@example.com",
    },
    deliveryAddress: {
      street: "1234 Rue Saint-Denis",
      city: "Montréal",
      postalCode: "H2X 3K8",
      province: "QC",
    },
    status: "pending",
    items: [
      { productName: "Croissants au beurre", quantity: 6, price: 3.5 },
      { productName: "Pain de campagne", quantity: 1, price: 5.75 },
      { productName: "Tartelettes aux fruits", quantity: 4, price: 4.25 },
    ],
    totalAmount: 42.5,
    estimatedDeliveryTime: "14:30",
    createdAt: "2026-02-12T10:30:00Z", // AUJOURD'HUI
  },
  {
    id: "mock-002",
    orderNumber: "CMD-2026-002",
    clientInfo: {
      firstName: "Jean",
      lastName: "Dubois",
      phone: "514-555-0147",
      email: "jean.dubois@example.com",
    },
    deliveryAddress: {
      street: "2567 Avenue du Mont-Royal",
      city: "Montréal",
      postalCode: "H2H 1K6",
      province: "QC",
    },
    status: "pending",
    items: [
      { productName: "Baguette tradition", quantity: 3, price: 4.25 },
      { productName: "Éclairs au chocolat", quantity: 6, price: 3.5 },
    ],
    totalAmount: 28.75,
    estimatedDeliveryTime: "15:00",
    createdAt: "2026-02-12T11:15:00Z", // AUJOURD'HUI
  },
  {
    id: "mock-003",
    orderNumber: "CMD-2026-003",
    clientInfo: {
      firstName: "Marie",
      lastName: "Tremblay",
      phone: "450-555-0198",
      email: "marie.tremblay@example.com",
    },
    deliveryAddress: {
      street: "789 Boulevard des Laurentides",
      city: "Laval",
      postalCode: "H7G 2V9",
      province: "QC",
    },
    status: "in_transit",
    items: [
      { productName: "Gâteau forêt noire", quantity: 1, price: 45.0 },
      { productName: "Macarons assortis", quantity: 12, price: 1.25 },
    ],
    totalAmount: 65.0,
    estimatedDeliveryTime: "15:30",
    createdAt: "2026-02-12T09:45:00Z", // AUJOURD'HUI
  },
  {
    id: "mock-004",
    orderNumber: "CMD-2026-004",
    clientInfo: {
      firstName: "Isabelle",
      lastName: "Côté",
      phone: "450-555-0134",
      email: "isabelle.cote@example.com",
    },
    deliveryAddress: {
      street: "3210 Chemin de la Côte-Vertu",
      city: "Montréal",
      postalCode: "H4R 1P8",
      province: "QC",
    },
    status: "arrived",
    items: [
      { productName: "Tarte tatin", quantity: 1, price: 32.0 },
      { productName: "Millefeuille", quantity: 2, price: 7.5 },
      { productName: "Pain au chocolat", quantity: 6, price: 2.8 },
    ],
    totalAmount: 52.8,
    estimatedDeliveryTime: "16:30",
    createdAt: "2026-02-12T08:20:00Z", // AUJOURD'HUI
  },
  {
    id: "mock-005",
    orderNumber: "CMD-2026-005",
    clientInfo: {
      firstName: "Thomas",
      lastName: "Leroy",
      phone: "514-555-0188",
      email: "thomas.leroy@example.com",
    },
    deliveryAddress: {
      street: "567 Rue Peel",
      city: "Montréal",
      postalCode: "H3A 1W5",
      province: "QC",
    },
    status: "delivered",
    items: [
      { productName: "Fougasse", quantity: 2, price: 6.5 },
      { productName: "Financiers", quantity: 8, price: 2.25 },
    ],
    totalAmount: 31.0,
    estimatedDeliveryTime: "12:45",
    createdAt: "2026-02-11T07:15:00Z", // HIER
  },
  {
    id: "mock-006",
    orderNumber: "CMD-2026-006",
    clientInfo: {
      firstName: "Julie",
      lastName: "Bergeron",
      phone: "514-555-0199",
      email: "julie.bergeron@example.com",
    },
    deliveryAddress: {
      street: "890 Rue Notre-Dame",
      city: "Montréal",
      postalCode: "H3C 1K8",
      province: "QC",
    },
    status: "pending",
    items: [
      { productName: "Pain aux noix", quantity: 2, price: 7.25 },
      { productName: "Brownies", quantity: 6, price: 3.75 },
    ],
    totalAmount: 37.0,
    estimatedDeliveryTime: "11:00",
    createdAt: "2026-02-13T10:00:00Z", // DEMAIN
  },
  {
    id: "mock-007",
    orderNumber: "CMD-2026-007",
    clientInfo: {
      firstName: "Marc",
      lastName: "Lafleur",
      phone: "450-555-0177",
      email: "marc.lafleur@example.com",
    },
    deliveryAddress: {
      street: "4321 Boulevard Saint-Laurent",
      city: "Montréal",
      postalCode: "H2W 1Z8",
      province: "QC",
    },
    status: "pending",
    items: [
      { productName: "Tarte au citron", quantity: 1, price: 28.0 },
      { productName: "Muffins", quantity: 8, price: 2.5 },
    ],
    totalAmount: 48.0,
    estimatedDeliveryTime: "13:30",
    createdAt: "2026-02-14T09:30:00Z", // APRÈS-DEMAIN
  },
];

interface DeliveryDriver {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: "available" | "on_route" | "offline";
}

const DeliveryDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [driver, setDriver] = useState<DeliveryDriver | null>(null);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<DeliveryOrder | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [smsNotification, setSmsNotification] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        console.log("🚚 [DELIVERY] Checking auth...");
        const session = await getSessionUniversal();
        console.log("🚚 [DELIVERY] Session:", session);

        if (!session?.user) {
          console.warn("🚚 [DELIVERY] No user in session");
          setLoading(false);
          return;
        }

        const user: any = session.user;
        const userRole = user.user_metadata?.role || user.role;
        console.log("🚚 [DELIVERY] Role:", userRole);

        // Accept any authenticated user with delivery role (or no role check at all if role is missing)
        if (userRole && userRole !== "deliveryDriver") {
          console.warn("🚚 [DELIVERY] Wrong role:", userRole);
          setLoading(false);
          return;
        }

        const driverData: DeliveryDriver = {
          id: String(user.id),
          firstName: user.user_metadata?.firstName || user.name?.split(" ")[0] || "Livreur",
          lastName: user.user_metadata?.lastName || user.name?.split(" ")[1] || "",
          email: user.email,
          phone: user.user_metadata?.phone || "514-555-0100",
          status: "available",
        };

        console.log("🚚 [DELIVERY] Driver set:", driverData);
        setDriver(driverData);
        setLoading(false);
      } catch (e) {
        console.error("🚚 [DELIVERY] Auth error:", e);
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  useEffect(() => {
    const normalizeDeliveryStatus = (order: any): DeliveryOrder["status"] => {
      if (order.deliveryStatus === "in_transit" || order.deliveryStatus === "arrived") {
        return order.deliveryStatus;
      }
      if (order.deliveryStatus === "delivered" || order.status === "delivered") {
        return "delivered";
      }
      return "pending";
    };

    const normalizeOrder = (order: any): DeliveryOrder | null => {
      if (order.deliveryType !== "delivery") return null;
      if (["cancelled", "completed"].includes(order.status)) return null;

      const mappedStatus = normalizeDeliveryStatus(order);
      if (!["pending", "in_transit", "arrived", "delivered"].includes(mappedStatus)) {
        return null;
      }

      const client = order.clientInfo || order.client || {};
      const rawItems = Array.isArray(order.items) ? order.items : [];
      const items = rawItems.map((item: any) => ({
        productName:
          item.productName ||
          item.product?.name ||
          (item.productId ? `Produit #${item.productId}` : "Produit"),
        quantity: Number(item.quantity || 0),
        price: Number(item.unitPrice || item.price || 0),
      }));

      const estimatedDeliveryTime =
        order.deliverySlot ||
        order.deliveryTimeSlot ||
        (order.pickupDate ? new Date(order.pickupDate).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" }) : undefined);

      return {
        id: String(order._id || order.id),
        orderNumber: String(order.orderNumber || ""),
        clientInfo: {
          firstName: String(client.firstName || ""),
          lastName: String(client.lastName || ""),
          phone: String(client.phone || ""),
          email: String(client.email || ""),
        },
        deliveryAddress: {
          street: String(order.deliveryAddress?.street || ""),
          city: String(order.deliveryAddress?.city || ""),
          postalCode: String(order.deliveryAddress?.postalCode || ""),
          province: String(order.deliveryAddress?.province || ""),
        },
        status: mappedStatus,
        items,
        totalAmount: Number(order.total || 0),
        estimatedDeliveryTime,
        createdAt: String(order.deliveryDate || order.pickupDate || order.createdAt || new Date().toISOString()),
        paymentStatus: order.paymentStatus,
        assignedDriver: order.assignedDriver
          ? {
              id: String(order.assignedDriver.id || ""),
              name: String(order.assignedDriver.name || "Livreur"),
              assignedAt: order.assignedDriver.assignedAt,
            }
          : undefined,
      };
    };

    const loadOrders = async () => {
      try {
        setLoadError(null);
        const limit = 100;
        let page = 1;
        let hasMore = true;
        const collected: any[] = [];

        while (hasMore) {
          const response = await fetch(
            `${normalizedApiUrl}/api/orders?limit=${limit}&page=${page}`,
            {
              headers: authHeaders(),
              credentials: "include",
            },
          );

          if (!response.ok) {
            throw new Error(`API orders failed with status ${response.status}`);
          }

          const result = await response.json();
          const pageItems = result?.data?.items || [];
          const totalPages = Number(result?.data?.pagination?.totalPages || 0);

          if (Array.isArray(pageItems) && pageItems.length > 0) {
            collected.push(...pageItems);
          }

          if (totalPages > 0) {
            hasMore = page < totalPages;
          } else {
            hasMore = Array.isArray(pageItems) && pageItems.length === limit;
          }

          page += 1;
          if (page > 20) break;
        }

        const deliveryOrders = collected
          .map(normalizeOrder)
          .filter((order): order is DeliveryOrder => Boolean(order));

        if (deliveryOrders.length > 0 || !ENABLE_DELIVERY_MOCKS) {
          setOrders(deliveryOrders);
        } else {
          if (ENABLE_DELIVERY_MOCKS) {
            setOrders(MOCK_DELIVERY_ORDERS);
          } else {
            setOrders([]);
            setLoadError("Impossible de charger les livraisons (API indisponible).");
          }
        }
      } catch (error) {
        console.error("Failed to load delivery orders:", error);
        if (ENABLE_DELIVERY_MOCKS) {
          setOrders(MOCK_DELIVERY_ORDERS);
        } else {
          setOrders([]);
          setLoadError("Erreur de connexion au serveur de livraisons.");
        }
      }
    };

    if (driver) {
      loadOrders();
      const interval = setInterval(loadOrders, 30000);
      return () => clearInterval(interval);
    }
  }, [driver]);

  const handleLogout = async () => {
    try {
      await authClient.signOut();
      navigate("/se-connecter");
    } catch (error) {
      console.error("Logout error:", error);
      navigate("/se-connecter");
    }
  };

  const updateDeliveryStatus = async (
    orderId: string,
    newStatus: "in_transit" | "arrived" | "delivered"
  ) => {
    setOrders((prev) =>
      prev.map((order) =>
        order.id === orderId ? { ...order, status: newStatus } : order
      )
    );

    if (selectedOrder?.id === orderId) {
      setSelectedOrder({ ...selectedOrder, status: newStatus });
    }

    try {
      const res = await fetch(`${normalizedApiUrl}/api/orders/${orderId}/delivery-status`, {
        method: "PATCH",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ deliveryStatus: newStatus }),
      });
      const data = await res.json();
      if (data?.data?.smsSent) {
        setSmsNotification(data.data.smsSent);
        setTimeout(() => setSmsNotification(null), 4000);
      }
    } catch (error) {
      console.log("Backend sync failed:", error);
    }
  };

  // Interprète une valeur de date comme un JOUR CALENDAIRE local, sans décalage
  // de fuseau. Une date stockée à minuit UTC ("2026-06-25T00:00:00.000Z") ou une
  // chaîne "2026-06-25" doivent afficher le 25 juin, même en heure de Montréal.
  const toCalendarDate = (value: string) => {
    const s = String(value || "");
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(s);
  };

  const formatDate = (dateString: string) => {
    const date = toCalendarDate(dateString);
    return date.toLocaleDateString("fr-CA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const formatOrderNumber = (orderNumber: string) => {
    const trimmed = String(orderNumber || "").trim();
    const mfMatch = trimmed.match(/^(MF-\d{8}-)(\d{1,4})$/i);
    if (mfMatch) {
      return mfMatch[2].padStart(4, "0");
    }

    if (/^\d+$/.test(trimmed)) {
      return String(Number(trimmed)).padStart(4, "0");
    }

    const parts = trimmed.split("-");
    const lastPart = parts[parts.length - 1] || trimmed;
    if (/^\d+$/.test(lastPart)) {
      return String(Number(lastPart)).padStart(4, "0");
    }

    return trimmed;
  };

  const formatDayName = (dateString: string) => {
    const date = toCalendarDate(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const afterTomorrow = new Date(today);
    afterTomorrow.setDate(today.getDate() + 2);
    
    if (isSameDay(date, today)) return "Aujourd'hui";
    if (isSameDay(date, tomorrow)) return "Demain";
    if (isSameDay(date, afterTomorrow)) return "Après-demain";
    
    return date.toLocaleDateString("fr-CA", { weekday: "long" });
  };

  const isSameDay = (dateA: Date, dateB: Date) => {
    return (
      dateA.getFullYear() === dateB.getFullYear() &&
      dateA.getMonth() === dateB.getMonth() &&
      dateA.getDate() === dateB.getDate()
    );
  };

  const getFilteredOrders = () => {
    let filtered = orders;
    
    // Filtre par statut
    if (statusFilter !== "all") {
      filtered = filtered.filter((order) => order.status === statusFilter);
    }
    
    // Filtre par date - CORRIGÉ POUR 2026
    if (dateFilter !== "all") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      
      const afterTomorrow = new Date(today);
      afterTomorrow.setDate(today.getDate() + 2);
      
      filtered = filtered.filter((order) => {
        const orderDate = toCalendarDate(order.createdAt);
        orderDate.setHours(0, 0, 0, 0);
        
        if (dateFilter === "today") {
          return orderDate.getTime() === today.getTime();
        }
        if (dateFilter === "tomorrow") {
          return orderDate.getTime() === tomorrow.getTime();
        }
        if (dateFilter === "afterTomorrow") {
          return orderDate.getTime() === afterTomorrow.getTime();
        }
        return true;
      });
    }
    
    return filtered;
  };

  // Nombre de livraisons prévues AUJOURD'HUI (pour le petit badge de notification)
  const todayDeliveriesCount = orders.filter((order) => {
    const d = toCalendarDate(order.createdAt);
    d.setHours(0, 0, 0, 0);
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return d.getTime() === t.getTime();
  }).length;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#C5A065] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!driver) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center max-w-md p-8">
          <p className="text-base text-gray-700 mb-4">Session expirée ou non autorisée.</p>
          <button
            onClick={() => navigate("/se-connecter")}
            className="px-6 py-2 bg-[#C5A065] text-white rounded-lg hover:bg-[#b8935a]"
          >
            Se reconnecter
          </button>
        </div>
      </div>
    );
  }

  const filteredOrders = getFilteredOrders();

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* SMS Notification Toast */}
      {smsNotification && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-5 py-3 rounded-xl shadow-xl flex items-center gap-3 animate-fade-in max-w-sm">
          <span className="text-lg">SMS</span>
          <div>
            <p className="text-sm font-bold">SMS envoyé au client</p>
            <p className="text-xs opacity-90 mt-0.5">{smsNotification}</p>
          </div>
        </div>
      )}
      {/* SIDEBAR */}
      <aside className="w-64 bg-white border-r border-gray-200 fixed h-full hidden md:block shadow-sm">
        <div className="p-6">
          <h1
            className="text-2xl mb-1"
            style={{
              fontFamily: '"Great Vibes", cursive',
              color: "#C5A065",
            }}
          >
            Marius & Fanny
          </h1>
          <p className="text-xs text-gray-500 uppercase tracking-wider">DELIVERY PANEL</p>
        </div>

        <div className="px-4 py-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 mb-2">
            Principal
          </p>
          <div className="bg-[#C5A065] bg-opacity-10 text-[#C5A065] flex items-center gap-3 px-4 py-3 rounded-lg">
            <Package className="w-5 h-5" />
             <span className="font-medium text-white">Commandes</span>
            <span className="ml-auto px-2 py-0.5 text-xs bg-[#C5A065] text-white rounded-full">
              {filteredOrders.length}
            </span>
          </div>
        </div>

        <div className="absolute bottom-0 w-64 p-6 border-t border-gray-200">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 text-gray-600 hover:bg-gray-50 rounded-lg w-full transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>Déconnexion</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <div className="flex-1 md:ml-64">
        {/* HEADER */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
          <div className="flex items-center justify-between px-6 h-16">
            <div className="flex items-center gap-4">
              <button
                className="md:hidden p-2 rounded-lg hover:bg-gray-100"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              >
                {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
              <h2 className="text-xl font-semibold text-gray-900">Commandes</h2>
              {todayDeliveriesCount > 0 && (
                <span className="inline-flex items-center gap-1 bg-[#C5A065] text-white text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap">
                  <Package className="w-3.5 h-3.5" />
                  {todayDeliveriesCount} aujourd'hui
                </span>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-[#C5A065] rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-white" />
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-medium text-gray-900">
                    {driver.firstName} {driver.lastName}
                  </p>
                  <p className="text-xs text-gray-500">Livreur</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* MOBILE MENU */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-black bg-opacity-50">
            <div className="absolute left-0 top-0 bottom-0 w-64 bg-white">
              <div className="p-6">
                <h1
                  className="text-2xl mb-1"
                  style={{
                    fontFamily: '"Great Vibes", cursive',
                    color: "#C5A065",
                  }}
                >
                  Marius & Fanny
                </h1>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-6">DELIVERY PANEL</p>
                
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 mb-2">
                  Principal
                </p>
                <div className="bg-[#C5A065] bg-opacity-10 text-[#C5A065] flex items-center gap-3 px-4 py-3 rounded-lg">
                  <Package className="w-5 h-5" />
                  <span className="font-medium">Commandes</span>
                </div>
              </div>

              <div className="absolute bottom-0 w-64 p-6 border-t border-gray-200">
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 px-4 py-3 text-gray-600 hover:bg-gray-50 rounded-lg w-full"
                >
                  <LogOut className="w-5 h-5" />
                  <span>Déconnexion</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PAGE CONTENT */}
        <div className="p-3 sm:p-6 lg:p-8">
          {/* FILTRES - REPOSITIONNÉS */}
          <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <Filter className="w-4 h-4" />
                  <span className="text-sm font-medium">Filtres</span>
                </button>
                
                <div className="flex items-center gap-2 flex-wrap">
                  {statusFilter !== "all" && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-[#C5A065] bg-opacity-10 rounded-full">
                      <span className="text-xs font-medium text-[#C5A065]">
                        {statusFilter === "pending" && "En attente"}
                        {statusFilter === "in_transit" && "En route"}
                        {statusFilter === "arrived" && "Arrivé"}
                        {statusFilter === "delivered" && "Livré"}
                      </span>
                      <button
                        onClick={() => setStatusFilter("all")}
                        className="text-[#C5A065] hover:text-[#B38F55]"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  
                  {dateFilter !== "all" && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-full">
                      <Calendar className="w-3 h-3 text-blue-600" />
                      <span className="text-xs font-medium text-blue-700">
                        {dateFilter === "today" && "Aujourd'hui"}
                        {dateFilter === "tomorrow" && "Demain"}
                        {dateFilter === "afterTomorrow" && "Après-demain"}
                      </span>
                      <button
                        onClick={() => setDateFilter("all")}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="text-sm text-gray-500">
                <span className="font-medium text-gray-700">{filteredOrders.length}</span> commande(s)
              </div>
            </div>

            {/* PANEL DE FILTRES DÉROULANT */}
            {showFilters && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Filtre par statut */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">

                  {loadError && (
                    <div className="mb-6 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                      {loadError}
                    </div>
                  )}
                      Statut de livraison
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setStatusFilter("all")}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                          statusFilter === "all"
                            ? "bg-[#C5A065] text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        Toutes
                      </button>
                      <button
                        onClick={() => setStatusFilter("pending")}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                          statusFilter === "pending"
                            ? "bg-yellow-500 text-white"
                            : "bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                        }`}
                      >
                        En attente
                      </button>
                      <button
                        onClick={() => setStatusFilter("in_transit")}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                          statusFilter === "in_transit"
                            ? "bg-blue-500 text-white"
                            : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                        }`}
                      >
                        En route
                      </button>
                      <button
                        onClick={() => setStatusFilter("arrived")}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                          statusFilter === "arrived"
                            ? "bg-green-500 text-white"
                            : "bg-green-50 text-green-700 hover:bg-green-100"
                        }`}
                      >
                        Arrivé
                      </button>
                      <button
                        onClick={() => setStatusFilter("delivered")}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                          statusFilter === "delivered"
                            ? "bg-gray-700 text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        Livré
                      </button>
                    </div>
                  </div>

                  {/* Filtre par date */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                      Date de livraison
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setDateFilter("all")}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                          dateFilter === "all"
                            ? "bg-[#C5A065] text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        Toutes
                      </button>
                      <button
                        onClick={() => setDateFilter("today")}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                          dateFilter === "today"
                            ? "bg-blue-500 text-white"
                            : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                        }`}
                      >
                        Aujourd'hui
                      </button>
                      <button
                        onClick={() => setDateFilter("tomorrow")}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                          dateFilter === "tomorrow"
                            ? "bg-blue-500 text-white"
                            : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                        }`}
                      >
                        Demain
                      </button>
                      <button
                        onClick={() => setDateFilter("afterTomorrow")}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                          dateFilter === "afterTomorrow"
                            ? "bg-blue-500 text-white"
                            : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                        }`}
                      >
                        Après-demain
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* VUE MOBILE (portrait, dans la voiture) — cartes empilées */}
          <div className="md:hidden space-y-3">
            {filteredOrders.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-6 py-12 text-center">
                <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">Aucune commande trouvée</p>
              </div>
            ) : (
              filteredOrders.map((order) => (
                <button
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  className="w-full text-left bg-white rounded-lg shadow-sm border border-gray-200 p-4 active:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-gray-900 text-base">
                        #{formatOrderNumber(order.orderNumber)}
                      </div>
                      <div className="text-xs text-blue-600 font-medium mt-0.5">
                        {formatDayName(order.createdAt)} · {formatDate(order.createdAt)}
                        {order.estimatedDeliveryTime ? ` · ${order.estimatedDeliveryTime}` : ""}
                      </div>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                        order.status === "pending"
                          ? "bg-yellow-100 text-yellow-800"
                          : order.status === "in_transit"
                          ? "bg-blue-100 text-blue-800"
                          : order.status === "arrived"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {order.status === "pending" && "En attente"}
                      {order.status === "in_transit" && "En route"}
                      {order.status === "arrived" && "Arrivé"}
                      {order.status === "delivered" && "Livré"}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-gray-900 font-medium">
                      <User className="w-4 h-4 text-gray-400 shrink-0" />
                      {order.clientInfo.firstName} {order.clientInfo.lastName}
                    </div>
                    {order.clientInfo.phone && (
                      <a
                        href={`tel:${order.clientInfo.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 text-blue-600 font-medium"
                      >
                        <Phone className="w-4 h-4 shrink-0" />
                        {order.clientInfo.phone}
                      </a>
                    )}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        `${order.deliveryAddress.street}, ${order.deliveryAddress.city}`,
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-start gap-2 text-gray-700"
                    >
                      <MapPin className="w-4 h-4 text-[#C5A065] shrink-0 mt-0.5" />
                      <span className="underline decoration-gray-300">
                        {order.deliveryAddress.street}, {order.deliveryAddress.city}
                      </span>
                    </a>
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                    <span className="font-semibold text-gray-900">
                      {order.totalAmount.toFixed(2)}$
                    </span>
                    <span className="text-[#C5A065] font-medium text-sm flex items-center gap-1">
                      Voir détails <ChevronRight className="w-4 h-4" />
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* TABLEAU DES COMMANDES (ordinateur) - FOND BLANC */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Commande
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Client
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Adresse
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Statut
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Total
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center bg-white">
                        <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-500">Aucune commande trouvée</p>
                        <p className="text-sm text-gray-400 mt-1">
                          {statusFilter !== "all" || dateFilter !== "all"
                            ? "Essayez de modifier vos filtres"
                            : "Les nouvelles livraisons apparaîtront ici"}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => (
                      <tr
                        key={order.id}
                        className="hover:bg-gray-50 cursor-pointer transition-colors bg-white"
                        onClick={() => setSelectedOrder(order)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-medium text-gray-900">
                            {formatOrderNumber(order.orderNumber)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {order.estimatedDeliveryTime}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-1 text-sm text-gray-900">
                            <Calendar className="w-3.5 h-3.5 text-gray-400" />
                            <span>{formatDate(order.createdAt)}</span>
                          </div>
                          <div className="text-xs text-blue-600 font-medium mt-1">
                            {formatDayName(order.createdAt)}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                            <Clock className="w-3 h-3 text-gray-400" />
                            <span>{new Date(order.createdAt).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {order.clientInfo.firstName} {order.clientInfo.lastName}
                          </div>
                          <div className="text-xs text-gray-500">
                            {order.clientInfo.phone}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-600">
                            {order.deliveryAddress.street}
                          </div>
                          <div className="text-xs text-gray-500">
                            {order.deliveryAddress.city}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-medium ${
                              order.status === "pending"
                                ? "bg-yellow-100 text-yellow-800"
                                : order.status === "in_transit"
                                ? "bg-blue-100 text-blue-800"
                                : order.status === "arrived"
                                ? "bg-green-100 text-green-800"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {order.status === "pending" && "En attente"}
                            {order.status === "in_transit" && "En route"}
                            {order.status === "arrived" && "Arrivé"}
                            {order.status === "delivered" && "Livré"}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-medium text-gray-900">
                            {order.totalAmount.toFixed(2)}$
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedOrder(order);
                            }}
                            className="text-[#C5A065] hover:text-[#B38F55] font-medium text-sm flex items-center gap-1 transition-colors"
                          >
                            Voir détails
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL DÉTAILS COMMANDE */}
      <Modal
        open={!!selectedOrder}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
        type="details"
        title={`Commande ${formatOrderNumber(selectedOrder?.orderNumber || "")}`}
        description={`Client: ${selectedOrder?.clientInfo.firstName} ${selectedOrder?.clientInfo.lastName}`}
        size="lg"
        closable={true}
        actions={{
          ...(selectedOrder?.status === "pending" && {
            primary: {
              label: "Commencer la livraison",
              onClick: () =>
                selectedOrder && updateDeliveryStatus(selectedOrder.id, "in_transit"),
            },
          }),
          ...(selectedOrder?.status === "in_transit" && {
            primary: {
              label: "Arrivé sur place",
              onClick: () =>
                selectedOrder && updateDeliveryStatus(selectedOrder.id, "arrived"),
            },
          }),
          ...(selectedOrder?.status === "arrived" && {
            primary: {
              label: "Terminer la livraison",
              onClick: () =>
                selectedOrder && updateDeliveryStatus(selectedOrder.id, "delivered"),
            },
          }),
        }}
      >
        {selectedOrder && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-medium text-gray-500 mb-3">Informations client</h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-gray-400" />
                    <span>{selectedOrder.clientInfo.firstName} {selectedOrder.clientInfo.lastName}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-4 h-4 text-gray-400" />
                    <a href={`tel:${selectedOrder.clientInfo.phone}`} className="text-[#C5A065] hover:underline">
                      {selectedOrder.clientInfo.phone}
                    </a>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                    <div>
                      <p>{selectedOrder.deliveryAddress.street}</p>
                      <p>{selectedOrder.deliveryAddress.city}, {selectedOrder.deliveryAddress.postalCode}</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-gray-500 mb-3">Résumé</h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Package className="w-4 h-4 text-gray-400" />
                    <span>{selectedOrder.items.length} article(s)</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span>Livraison: {selectedOrder.estimatedDeliveryTime}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span>Commandé: {formatDate(selectedOrder.createdAt)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-gray-500 mb-3">Articles</h4>
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                {selectedOrder.items.map((item, index) => (
                  <div key={index} className="flex justify-between text-sm">
                    <span>{item.productName} × {item.quantity}</span>
                    {item.price && (
                      <span className="font-medium">{(item.price * item.quantity).toFixed(2)}$</span>
                    )}
                  </div>
                ))}
                <div className="border-t border-gray-200 pt-2 mt-2 flex justify-between font-medium">
                  <span>Total</span>
                  <span className="text-[#C5A065]">{selectedOrder.totalAmount.toFixed(2)}$</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default DeliveryDashboard;