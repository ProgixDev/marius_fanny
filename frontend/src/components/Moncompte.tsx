import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authClient } from "../lib/AuthClient";
import { authHeaders } from "../utils/authHeaders";
import { getSessionUniversal } from "../utils/getSession";
import { parseServiceDate } from "../utils/dates";
import GoldenBackground from "./GoldenBackground";
import {
  User,
  Package,
  LogOut,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  Clock,
  CheckCircle,
  Truck,
  ArrowLeft,
} from "lucide-react";

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  amount: number;
}

interface DeliveryAddress {
  street?: string;
  city?: string;
  postalCode?: string;
}

interface Order {
  _id: string;
  userId: string;
  clientInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  items: OrderItem[];
  subtotal: number;
  taxAmount: number;
  deliveryFee: number;
  total: number;
  status: string;
  deliveryType: string;
  deliveryAddress?: DeliveryAddress;
  pickupDate?: string;
  pickupLocation?: string;
  orderDate: string;
  createdAt: string;
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const statusConfig: Record<
    string,
    { bg: string; text: string; icon: React.ReactNode; label: string }
  > = {
    pending: {
      bg: "bg-yellow-100",
      text: "text-yellow-800",
      icon: <Clock size={14} />,
      label: "En attente",
    },
    confirmed: {
      bg: "bg-blue-100",
      text: "text-blue-800",
      icon: <CheckCircle size={14} />,
      label: "Confirmée",
    },
    processing: {
      bg: "bg-purple-100",
      text: "text-purple-800",
      icon: <Package size={14} />,
      label: "En préparation",
    },
    shipped: {
      bg: "bg-indigo-100",
      text: "text-indigo-800",
      icon: <Truck size={14} />,
      label: "Expédiée",
    },
    delivered: {
      bg: "bg-green-100",
      text: "text-green-800",
      icon: <CheckCircle size={14} />,
      label: "Livrée",
    },
    cancelled: {
      bg: "bg-red-100",
      text: "text-red-800",
      icon: <LogOut size={14} />,
      label: "Annulée",
    },
  };

  const config = statusConfig[status] || statusConfig.pending;
  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-bold ${config.bg} ${config.text} flex items-center gap-1.5 w-fit transition-all duration-300`}
    >
      {config.icon}
      {config.label}
    </span>
  );
};

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}> = ({ icon, label, value, color }) => (
  <div className="bg-white/70 backdrop-blur-md p-5 rounded-2xl border border-white shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
    <div className={`p-2.5 ${color} rounded-lg w-fit mb-3`}>{icon}</div>
    <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">
      {label}
    </p>
    <p className="text-xl font-bold text-stone-800">{value}</p>
  </div>
);

const Dashboard: React.FC = () => {
  const [userInfo, setUserInfo] = useState<any>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showConfirmLogout, setShowConfirmLogout] = useState(false);

  const navigate = useNavigate();

  const ITEMS_PER_PAGE = 10;

  // parseServiceDate : une date de livraison « 2026-08-14 » vaut minuit UTC si
  // on la passe telle quelle à `new Date`, et s'affichait donc la veille.
  const formatDate = (date?: string | Date | null) => {
    const parsed = parseServiceDate(date);
    if (!parsed) return "—";
    return parsed.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/Montreal",
    });
  };

  const getScheduledDate = (order: any) => {
    if (order?.deliveryType === "pickup") {
      return order.pickupDate || order.deliveryDate || order.orderDate || order.createdAt;
    }
    return order.deliveryDate || order.pickupDate || order.orderDate || order.createdAt;
  };

  const formatAmount = (amount: number) =>
    `${amount.toFixed(2).replace(".", ",")} $`;

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // Récupérer l'utilisateur
        const session = await getSessionUniversal();
        if (session?.user) {
          const u: any = session.user;
          const userCopy = {
            id: u.id,
            email: u.email,
            name: u.name,
            emailVerified: u.emailVerified,
            image: u.image,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
          };
          setUserInfo(userCopy);
          console.log("✅ Utilisateur connecté:", userCopy.email);
        } else {
          throw new Error("Non connecté");
        }

        // Récupérer les commandes depuis l'API backend
        console.log("📡 Récupération des commandes depuis le backend...");

        // Pagination: récupérer plusieurs pages (sinon les anciennes commandes disparaissent après 100).
        const API_URL = (await import('../utils/api')).API_URL;
        const limit = 100;
        const maxPages = 20;
        let page = 1;
        let pagedOrders: any[] = [];

        while (page <= maxPages) {
          const apiUrl = `${API_URL}/api/orders?page=${page}&limit=${limit}`;
          const response = await fetch(apiUrl, {
            credentials: "include",
            headers: authHeaders(),
          });

          const responseText = await response.text();
          if (
            responseText.includes("<!") ||
            responseText.includes("<html") ||
            responseText.includes("<!DOCTYPE")
          ) {
            throw new Error("Page HTML reçue au lieu de JSON");
          }

          if (!response.ok) {
            const data = JSON.parse(responseText);
            throw new Error(data.message || `Erreur ${response.status}`);
          }

          const data = JSON.parse(responseText);
          const pageItems = data.data?.items || data.data || [];
          pagedOrders = pagedOrders.concat(pageItems);

          const totalPages = Number(data.data?.pagination?.totalPages || 0);
          if (totalPages > 0) {
            if (page >= totalPages) break;
          } else if (pageItems.length < limit) {
            break;
          }

          page += 1;
        }

        setOrders(pagedOrders);
        setError(null);
        console.log(`✅ ${pagedOrders.length} commande(s) chargée(s)`);
        return;

        const apiUrl = `${(await import('../utils/api')).API_URL}/api/orders?limit=100`;
        console.log(`🔗 Appel: ${apiUrl}`);

        const response = await fetch(apiUrl, {
          credentials: "include",
          headers: authHeaders(),
        });

        console.log(
          `📊 Status: ${response.status}, Content-Type: ${response.headers.get("content-type")}`,
        );

        // Lire le contenu en texte d'abord
        const responseText = await response.text();
        console.log("📄 Réponse brute:", responseText.substring(0, 300));

        // Vérifier si c'est du HTML
        if (
          responseText.includes("<!") ||
          responseText.includes("<html") ||
          responseText.includes("<!DOCTYPE")
        ) {
          console.error("🔴 HTML reçu:", responseText.substring(0, 150));
          throw new Error("Page HTML reçue au lieu de JSON");
        }

        if (!response.ok) {
          const data = JSON.parse(responseText);
          throw new Error(data.message || `Erreur ${response.status}`);
        }

        // Parser le JSON
        const data = JSON.parse(responseText);
        console.log("✅ Réponse API:", data);

        const fetchedOrders = data.data?.items || data.data || [];
        setOrders(fetchedOrders);
        setError(null);

        console.log(`✅ ${fetchedOrders.length} commande(s) chargée(s)`);
      } catch (err: any) {
        console.error("❌ Erreur complète:", err);
        setError(err.message || "Impossible de charger les commandes");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    let result = [...orders];

    if (searchTerm) {
      result = result.filter(
        (order) =>
          order._id.toLowerCase().includes(searchTerm.toLowerCase()) ||
          order.clientInfo?.name
            ?.toLowerCase()
            .includes(searchTerm.toLowerCase()) ||
          order.clientInfo?.email
            ?.toLowerCase()
            .includes(searchTerm.toLowerCase()),
      );
    }

    // Filtrage par statut
    if (filterStatus !== "all") {
      result = result.filter((order) => order.status === filterStatus);
    }

    // Tri
    result.sort((a, b) => {
      switch (sortBy) {
        case "date":
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        case "amount":
          return b.total - a.total;
        default:
          return 0;
      }
    });

    setFilteredOrders(result);
    setCurrentPage(1);
  }, [searchTerm, filterStatus, sortBy, orders]);

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / ITEMS_PER_PAGE);
  const paginatedOrders = filteredOrders.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  // Statistiques pertinentes pour le client
  const allOrders = filteredOrders.length > 0 ? filteredOrders : orders;
  const lastOrder = allOrders.length > 0 ? allOrders[0] : null;
  const stats = {
    totalMoney: orders.reduce((sum, order) => sum + order.total, 0),
    lastOrderDate: lastOrder ? formatDate(lastOrder.createdAt) : "Aucune",
    lastOrderStatus: lastOrder?.status || "N/A",
    totalCommands: orders.length,
  };

  if (loading) {
    return (
      <div className="relative min-h-screen w-full bg-[#F9F7F2] pt-28 pb-12 px-4 flex items-center justify-center">
        <div className="absolute inset-0 z-0 opacity-30">
          <GoldenBackground />
        </div>
        <div className="relative z-10 text-center">
          <div className="w-12 h-12 border-4 border-[#337957]/30 border-t-[#337957] rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-stone-500 font-light">
            Chargement de vos commandes...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full bg-[#F9F7F2] pt-28 pb-12 px-4 md:px-6">
      <div className="absolute inset-0 z-0 opacity-30">
        <GoldenBackground />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1
            className="text-4xl md:text-5xl mb-2 font-light"
            style={{ fontFamily: '"Great Vibes", cursive', color: "#337957" }}
          >
            Mon Espace Personnel
          </h1>
          <p className="text-xs font-black uppercase tracking-[0.3em] text-stone-500">
            Bienvenue, {userInfo?.name || userInfo?.email || "Cher Client"}
          </p>
        </div>

        {/* Profil et Statistiques */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {/* Mon Profil */}
          <div className="bg-white/70 backdrop-blur-md p-6 rounded-2xl border border-white shadow-lg hover:shadow-xl transition-all duration-300 lg:col-span-1 md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-[#337957]/10 rounded-lg text-[#337957]">
                <User size={20} />
              </div>
              <h3 className="font-bold uppercase tracking-widest text-xs">
                Mon Profil
              </h3>
            </div>
            <div className="space-y-2 text-xs text-stone-600">
              <div>
                <span className="font-bold opacity-50 uppercase text-[9px] block">
                  Email
                </span>
                <p className="truncate">{userInfo?.email}</p>
              </div>
            </div>
          </div>

          {/* Statistiques Client */}
          <StatCard
            icon={<Package size={20} className="text-[#337957]" />}
            label="Total Commandes"
            value={stats.totalCommands}
            color="bg-[#337957]/10"
          />
          <StatCard
            icon={<Clock size={20} className="text-blue-600" />}
            label="Dernière Commande"
            value={stats.lastOrderDate}
            color="bg-blue-100"
          />
          <StatCard
            icon={<CheckCircle size={20} className="text-amber-600" />}
            label="Statut Dernière"
            value={
              stats.lastOrderStatus === "N/A"
                ? "—"
                : stats.lastOrderStatus.charAt(0).toUpperCase() +
                  stats.lastOrderStatus.slice(1)
            }
            color="bg-amber-100"
          />
        </div>

        {/* Section Commandes */}
        {error && (
          <div className="bg-red-50/80 backdrop-blur-md border border-red-200 rounded-2xl p-4 mb-6 text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="bg-white/70 backdrop-blur-md rounded-3xl border border-white shadow-xl p-6 md:p-8">
          {/* Header des Commandes */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
            <h2 className="text-2xl font-bold text-stone-800">Mes Commandes</h2>
            {orders.length > 0 && (
              <p className="text-sm text-stone-500">
                <span className="font-bold text-[#337957]">
                  {filteredOrders.length}
                </span>{" "}
                commande(s)
              </p>
            )}
          </div>

          {orders.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-4 text-stone-300">
                <Package size={40} />
              </div>
              <p className="text-stone-500 font-light italic text-lg">
                Aucune commande pour le moment
              </p>
              <p className="text-stone-400 text-sm mt-2">
                Commencez vos achats dès maintenant !
              </p>
            </div>
          ) : (
            <>
              {/* Filtres et Recherche */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {/* Recherche */}
                <div className="relative lg:col-span-2">
                  <Search
                    className="absolute left-3 top-3 text-stone-400"
                    size={18}
                  />
                  <input
                    type="text"
                    placeholder="Rechercher par ID, nom, email..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#337957] focus:border-transparent transition-all text-sm"
                  />
                </div>

                {/* Filtre Statut */}
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#337957] text-sm cursor-pointer"
                >
                  <option value="all">Tous les statuts</option>
                  <option value="pending">En attente</option>
                  <option value="confirmed">Confirmée</option>
                  <option value="processing">En préparation</option>
                  <option value="shipped">Expédiée</option>
                  <option value="delivered">Livrée</option>
                  <option value="cancelled">Annulée</option>
                </select>

                {/* Tri */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#337957] text-sm cursor-pointer"
                >
                  <option value="date">Tri : Récent</option>
                  <option value="amount">Tri : Montant ↓</option>
                </select>
              </div>

              {/* Tableau Commandes */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-stone-200">
                    <tr>
                      <th className="text-left py-3 px-4 font-bold text-stone-700 text-xs uppercase tracking-wider">
                        Commande
                      </th>
                      <th className="text-left py-3 px-4 font-bold text-stone-700 text-xs uppercase tracking-wider">
                        Date
                      </th>
                      <th className="text-left py-3 px-4 font-bold text-stone-700 text-xs uppercase tracking-wider">
                        Articles
                      </th>
                      <th className="text-right py-3 px-4 font-bold text-stone-700 text-xs uppercase tracking-wider">
                        Montant
                      </th>
                      <th className="text-left py-3 px-4 font-bold text-stone-700 text-xs uppercase tracking-wider">
                        Statut
                      </th>
                      <th className="text-center py-3 px-4 font-bold text-stone-700 text-xs uppercase tracking-wider">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {paginatedOrders.map((order) => (
                      <tr
                        key={order._id}
                        className="hover:bg-stone-50/50 transition-colors duration-200"
                      >
                        <td className="py-3 px-4">
                          <span className="font-mono font-bold text-[#337957]">
                            {order._id.slice(-6).toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-stone-600">
                          {formatDate(getScheduledDate(order))}
                        </td>
                        <td className="py-3 px-4 text-stone-600">
                          {order.items.length} article(s)
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-stone-800">
                          {formatAmount(order.total)}
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => {
                              setSelectedOrder(order);
                              setShowDetails(true);
                            }}
                            className="p-2 hover:bg-[#337957]/10 rounded-lg transition-colors duration-200 text-[#337957]"
                            title="Voir détails"
                          >
                            <Eye size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6 pt-6 border-t border-stone-100">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg border border-stone-200 hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>

                  <div className="flex gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                      (page) => (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                            currentPage === page
                              ? "bg-[#337957] text-white"
                              : "border border-stone-200 hover:bg-stone-50"
                          }`}
                        >
                          {page}
                        </button>
                      ),
                    )}
                  </div>

                  <button
                    onClick={() =>
                      setCurrentPage(Math.min(totalPages, currentPage + 1))
                    }
                    disabled={currentPage === totalPages}
                    className="p-2 rounded-lg border border-stone-200 hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Détails */}
        {showDetails && selectedOrder && (
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowDetails(false)}
          >
            <div
              className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 md:p-8">
                {/* Header Modal */}
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-2xl font-bold text-stone-800">
                    Détails Commande
                  </h3>
                  <button
                    onClick={() => setShowDetails(false)}
                    className="text-stone-400 hover:text-stone-600 text-2xl w-8 h-8 flex items-center justify-center"
                  >
                    ✕
                  </button>
                </div>

                {/* Infos Commande */}
                <div className="space-y-4 mb-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-bold opacity-50 uppercase tracking-widest mb-1">
                        ID Commande
                      </p>
                      <p className="font-mono font-bold text-[#337957]">
                        {selectedOrder._id}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-bold opacity-50 uppercase tracking-widest mb-1">
                        Date
                      </p>
                      <p className="font-bold text-stone-800">
                        {formatDate(getScheduledDate(selectedOrder))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-bold opacity-50 uppercase tracking-widest mb-1">
                        Statut
                      </p>
                      <StatusBadge status={selectedOrder.status} />
                    </div>
                    <div>
                      <p className="text-xs font-bold opacity-50 uppercase tracking-widest mb-1">
                        Type Livraison
                      </p>
                      <p className="font-bold text-stone-800">
                        {selectedOrder.deliveryType === "delivery"
                          ? "Livraison"
                          : "Retrait"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mb-6">
                  <h4 className="text-sm font-bold text-stone-800 mb-3 uppercase tracking-widest">
                    Articles
                  </h4>
                  <div className="space-y-2 bg-stone-50 p-4 rounded-lg">
                    {selectedOrder.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span className="text-stone-600">
                          {item.name} × {item.quantity}
                        </span>
                        <span className="font-bold text-stone-800">
                          {formatAmount(item.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totaux */}
                <div className="space-y-2 mb-6 bg-stone-50 p-4 rounded-lg">
                  <div className="flex justify-between text-sm">
                    <span className="text-stone-600">Sous-total</span>
                    <span className="text-stone-800">
                      {formatAmount(selectedOrder.subtotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-stone-600">Taxes</span>
                    <span className="text-stone-800">
                      {formatAmount(selectedOrder.taxAmount)}
                    </span>
                  </div>
                  {selectedOrder.deliveryFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-stone-600">Livraison</span>
                      <span className="text-stone-800">
                        {formatAmount(selectedOrder.deliveryFee)}
                      </span>
                    </div>
                  )}
                  <div className="border-t border-stone-200 pt-2 flex justify-between">
                    <span className="font-bold text-stone-800">Total</span>
                    <span className="text-lg font-bold text-[#337957]">
                      {formatAmount(selectedOrder.total)}
                    </span>
                  </div>
                </div>

                {/* Adresse Livraison */}
                {selectedOrder.deliveryType === "delivery" &&
                  selectedOrder.deliveryAddress && (
                    <div className="mb-6 p-4 bg-stone-50 rounded-lg">
                      <p className="text-xs font-bold opacity-50 uppercase tracking-widest mb-2">
                        Adresse Livraison
                      </p>
                      <p className="text-sm text-stone-700">
                        {selectedOrder.deliveryAddress.street &&
                          `${selectedOrder.deliveryAddress.street}, `}
                        {selectedOrder.deliveryAddress.city &&
                          `${selectedOrder.deliveryAddress.city}, `}
                        {selectedOrder.deliveryAddress.postalCode}
                      </p>
                    </div>
                  )}

                {/* Bouton Fermeture */}
                <button
                  onClick={() => setShowDetails(false)}
                  className="w-full bg-[#2D2A26] text-white py-3 rounded-lg font-bold uppercase tracking-widest text-sm hover:bg-[#337957] transition-colors"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Boutons Actions */}
        <div className="mt-10 flex gap-13 justify-center">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[#2D2A26] hover:text-[#337957] transition-all"
          >
            <ArrowLeft size={14} /> Retour à l'accueil
          </button>
          <button
            onClick={() => setShowConfirmLogout(true)}
            className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-red-800/50 hover:text-red-800 transition-all"
          >
            <LogOut size={14} /> Se déconnecter
          </button>
        </div>

        {/* Modal Confirmation Déconnexion */}
        {showConfirmLogout && (
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowConfirmLogout(false)}
          >
            <div
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-2xl font-bold text-stone-800 mb-2">
                Êtes-vous sûr ?
              </h3>
              <p className="text-stone-500 mb-6">
                Voulez-vous vraiment vous déconnecter de votre compte ?
              </p>

              <div className="flex gap-4">
                <button
                  onClick={() => setShowConfirmLogout(false)}
                  className="flex-1 px-4 py-3 rounded-lg border border-stone-200 text-stone-800 font-bold uppercase tracking-widest text-xs hover:bg-stone-50 transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={() => {
                    authClient
                      .signOut()
                      .then(() => (window.location.href = "/"));
                  }}
                  className="flex-1 px-4 py-3 rounded-lg bg-red-600 text-white font-bold uppercase tracking-widest text-xs hover:bg-red-700 transition-all"
                >
                  Confirmer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
