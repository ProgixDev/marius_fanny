import { useState, useEffect } from "react";
import {
  Truck,
  MapPin,
  Calendar,
  Clock,
  User,
  Phone,
  Package,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  DollarSign,
  MapPinned,
  Eye,
  MoreVertical,
  Send,
  MapPinCheck,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { DataTable } from "./ui/DataTable";
import { Modal } from "./ui/modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import type { Order } from "../types";

const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
const normalizedApiUrl = API_URL.startsWith("http") ? API_URL : `https://${API_URL}`;
import { authHeaders } from "../utils/authHeaders";
import { parseServiceDate } from "../utils/dates";

interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
}

interface Assignment {
  orderId: string;
  driverId: string;
  driverName: string;
  assignedAt: string;
}

export default function DeliveryAssignment() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const [smsNotification, setSmsNotification] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch orders
      const ordersRes = await fetch(`${normalizedApiUrl}/api/orders`, {
        headers: authHeaders(),
        credentials: "include",
      });
      const ordersData = await ordersRes.json();
      const rawOrders = ordersData?.data?.items || ordersData?.data?.orders || [];
      // Normalize _id to id and filter delivery orders only
      const activeOrders = rawOrders
        .map((o: any) => ({ ...o, id: o._id || o.id }))
        .filter((o: any) => o.deliveryType === "delivery" && !["cancelled", "completed", "delivered"].includes(o.status));
      setOrders(activeOrders);

      // Build assignments from orders that have assignedDriver
      const savedAssignments: Assignment[] = activeOrders
        .filter((o: any) => o.assignedDriver?.id)
        .map((o: any) => ({
          orderId: o.id,
          driverId: o.assignedDriver.id,
          driverName: o.assignedDriver.name,
          assignedAt: o.assignedDriver.assignedAt,
        }));
      setAssignments(savedAssignments);

      // Fetch all users then filter delivery drivers
      const usersRes = await fetch(`${normalizedApiUrl}/api/users?limit=500`, {
        headers: authHeaders(),
        credentials: "include",
      });
      const usersData = await usersRes.json();
      if (usersData?.success) {
        const allUsers = usersData.data?.users || [];
        const driverUsers = allUsers
          .filter((u: any) => u.role === "deliveryDriver")
          .map((u: any) => ({
            id: u.id || u._id,
            name: u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim(),
            email: u.email,
            phone: u.phone || "",
          }));
        setDrivers(driverUsers);
      }
    } catch (err) {
      console.error("Erreur chargement livraisons:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const updateDeliveryStatus = async (orderId: string, newStatus: "in_transit" | "arrived" | "delivered") => {
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
      if (newStatus === "delivered") {
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
      }
    } catch (error) {
      console.error("Erreur mise à jour livraison:", error);
    }
  };

  const handleAssignClick = (order: Order) => {
    setSelectedOrder(order);
    setSelectedDriver(null);
    setIsAssignModalOpen(true);
  };

  const handleViewDetails = (order: Order) => {
    setSelectedOrder(order);
    setIsDetailsModalOpen(true);
  };

  const handleAssignDriver = async () => {
    if (!selectedOrder || !selectedDriver) return;
    const driver = drivers.find((d) => d.id === selectedDriver);
    const assignedAt = new Date().toISOString();
    const assignment: Assignment = {
      orderId: selectedOrder.id,
      driverId: selectedDriver,
      driverName: driver?.name || "Livreur",
      assignedAt,
    };

    // Update locally
    setAssignments((prev) => [...prev.filter((a) => a.orderId !== selectedOrder.id), assignment]);
    setIsAssignModalOpen(false);
    setSelectedOrder(null);
    setSelectedDriver(null);

    // Save to DB
    try {
      await fetch(`${normalizedApiUrl}/api/orders/${selectedOrder.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({
          assignedDriver: { id: selectedDriver, name: driver?.name || "Livreur", assignedAt },
        }),
      });
    } catch (err) {
      console.error("Erreur sauvegarde assignation:", err);
    }
  };

  const getAssignmentForOrder = (orderId: string) =>
    assignments.find((a) => a.orderId === orderId);

  const formatDate = (dateString?: string | Date | null) => {
    // parseServiceDate : « 2026-08-14 » (deliveryDate) est un jour calendaire ;
    // lu comme minuit UTC il s'affichait la veille en heure de Montréal.
    const parsed = parseServiceDate(dateString);
    if (!parsed) return "—";
    return parsed.toLocaleDateString("fr-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "America/Montreal",
    });
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(amount);

  const getStatusBadge = (status: string) => {
    const config: Record<string, { label: string; className: string }> = {
      pending: { label: "En attente", className: "bg-yellow-100 text-yellow-800" },
      confirmed: { label: "Confirmée", className: "bg-blue-100 text-blue-800" },
      in_production: { label: "En production", className: "bg-purple-100 text-purple-800" },
      ready: { label: "Prête", className: "bg-green-100 text-green-800" },
      completed: { label: "Ramassée", className: "bg-green-100 text-green-800" },
      cancelled: { label: "Annulée", className: "bg-red-100 text-red-800" },
    };
    const c = config[status] || { label: status, className: "bg-gray-100 text-gray-800" };
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.className}`}>{c.label}</span>;
  };

  const getPaymentBadge = (paymentStatus: string) => {
    const config: Record<string, { label: string; className: string }> = {
      unpaid: { label: "Non payé", className: "bg-red-100 text-red-800" },
      deposit_paid: { label: "Dépôt payé", className: "bg-yellow-100 text-yellow-800" },
      paid: { label: "Payé", className: "bg-green-100 text-green-800" },
    };
    const c = config[paymentStatus] || { label: paymentStatus, className: "bg-gray-100 text-gray-800" };
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.className}`}>{c.label}</span>;
  };

  const getOrderColor = (order: any) => {
    if (order.status === "completed") {
      return "!bg-green-50 border-l-4 !border-l-green-500";
    }
    if (order.pickupLocation === "Montreal" && order.deliveryType === "pickup") {
      return "!bg-blue-50 border-l-4 !border-l-blue-500";
    } else if (order.deliveryType === "delivery") {
      return "!bg-yellow-50 border-l-4 !border-l-yellow-500";
    } else if (order.pickupLocation === "Laval" && order.deliveryType === "pickup") {
      return "!bg-white border-l-4 !border-l-gray-300";
    }
    return "";
  };

  const columns = [
    {
      key: "orderNumber",
      label: "Commande",
      render: (order: Order) => (
        <span className="font-bold text-[#2D2A26]">
          {order.orderNumber?.split("-").pop() || order.orderNumber}
        </span>
      ),
    },
    {
      key: "client",
      label: "Client",
      render: (order: any) => {
        const c = order.clientInfo || order.client || {};
        return (
          <div>
            <div className="font-medium text-[#2D2A26]">
              {c.firstName} {c.lastName}
            </div>
            <div className="text-xs text-gray-500">{c.phone}</div>
          </div>
        );
      },
    },
    {
      key: "address",
      label: "Adresse",
      render: (order: Order) =>
        order.deliveryAddress ? (
          <div className="text-sm text-gray-600">
            <div>{order.deliveryAddress.street}</div>
            <div>{order.deliveryAddress.city}, {order.deliveryAddress.postalCode}</div>
          </div>
        ) : (
          <span className="text-xs text-gray-400 italic">Non définie</span>
        ),
    },
    {
      key: "pickupDate",
      label: "Date livraison",
      render: (order: Order) => (
        <div className="text-sm">
          <div className="font-medium">{formatDate((order as any).deliveryDate || order.pickupDate || order.orderDate)}</div>
          {(order.deliverySlot || (order as any).deliveryTimeSlot) && <div className="text-xs text-gray-500">{order.deliverySlot || (order as any).deliveryTimeSlot}</div>}
        </div>
      ),
    },
    {
      key: "status",
      label: "Statut",
      render: (order: Order) => getStatusBadge(order.status),
    },
    {
      key: "paymentStatus",
      label: "Paiement",
      render: (order: Order) => getPaymentBadge(order.paymentStatus),
    },
    {
      key: "total",
      label: "Total",
      render: (order: Order) => (
        <span className="font-medium text-[#2D2A26]">{formatCurrency(order.total)}</span>
      ),
    },
    {
      key: "driver",
      label: "Livreur",
      sortable: false,
      render: (order: Order) => {
        const assignment = getAssignmentForOrder(order.id);
        if (assignment) {
          return (
            <div className="flex items-center gap-2">
              <User size={14} className="text-[#C5A065]" />
              <span className="text-sm font-medium">{assignment.driverName}</span>
            </div>
          );
        }
        return <span className="text-xs text-gray-400 italic">Non assigné</span>;
      },
    },
    {
      key: "actions",
      label: "Actions",
      sortable: false,
      render: (order: Order) => {
        const assignment = getAssignmentForOrder(order.id);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <MoreVertical className="w-4 h-4 text-gray-600" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => handleViewDetails(order)}>
                <Eye className="w-4 h-4 mr-2" />
                Voir détails
              </DropdownMenuItem>
              {!assignment && (
                <DropdownMenuItem onClick={() => handleAssignClick(order)}>
                  <Truck className="w-4 h-4 mr-2" />
                  Assigner livreur
                </DropdownMenuItem>
              )}
              {assignment && order.deliveryType === "delivery" && (
                <>
                  <DropdownMenuItem onClick={() => updateDeliveryStatus(order.id, "in_transit")}>
                    <Send className="w-4 h-4 mr-2" />
                    En route (SMS client)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => updateDeliveryStatus(order.id, "arrived")}>
                    <MapPinCheck className="w-4 h-4 mr-2" />
                    Arrivé (SMS client)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => updateDeliveryStatus(order.id, "delivered")}>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Livré
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="h-full overflow-auto">
      {smsNotification && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-5 py-3 rounded-xl shadow-xl flex items-center gap-3 max-w-sm">
          <Send size={18} />
          <div>
            <p className="text-sm font-bold">SMS envoyé au client</p>
            <p className="text-xs opacity-90 mt-0.5">{smsNotification}</p>
          </div>
        </div>
      )}
      <header className="p-4 md:p-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2
              className="text-4xl md:text-5xl mb-2"
              style={{ fontFamily: '"Great Vibes", cursive', color: "#C5A065" }}
            >
              Attribution des livraisons
            </h2>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
              Assignez les commandes aux livreurs
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 text-sm font-medium text-stone-600 transition-colors"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Actualiser
          </button>
        </div>
      </header>

      <div className="p-4 md:p-8 pt-0">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-stone-500 font-medium">À livrer</p>
                <p className="text-2xl font-bold text-[#2D2A26]">{orders.length}</p>
              </div>
              <Package className="w-8 h-8 text-[#C5A065] opacity-60" />
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-stone-500 font-medium">Assignées</p>
                <p className="text-2xl font-bold text-blue-600">{assignments.length}</p>
              </div>
              <Truck className="w-8 h-8 text-blue-400 opacity-60" />
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-stone-500 font-medium">Non assignées</p>
                <p className="text-2xl font-bold text-amber-600">
                  {orders.length - assignments.filter((a) => orders.some((o) => o.id === a.orderId)).length}
                </p>
              </div>
              <AlertCircle className="w-8 h-8 text-amber-400 opacity-60" />
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-stone-500 font-medium">Livreurs</p>
                <p className="text-2xl font-bold text-green-600">{drivers.length}</p>
              </div>
              <User className="w-8 h-8 text-green-400 opacity-60" />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-[#C5A065]" size={40} />
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-12 text-center">
            <Truck size={48} className="mx-auto mb-4 text-stone-300" />
            <h3 className="text-lg font-bold text-stone-500 mb-2">Aucune commande à livrer</h3>
            <p className="text-sm text-stone-400">Les commandes de livraison prêtes et payées apparaîtront ici.</p>
          </div>
        ) : (
          <DataTable
            data={orders}
            columns={columns}
            searchPlaceholder="Rechercher une commande..."
            getSearchValue={(order: Order) =>
              `${order.orderNumber} ${(order as any).clientInfo?.firstName || order.client?.firstName || ""} ${(order as any).clientInfo?.lastName || order.client?.lastName || ""} ${(order as any).clientInfo?.phone || order.client?.phone || ""} ${order.deliveryAddress?.street || ""}`
            }
            itemsPerPage={10}
            rowClassName={(order: Order) => getOrderColor(order)}
          />
        )}
      </div>

      {/* Assign Driver Modal */}
      <Modal
        open={isAssignModalOpen}
        onOpenChange={setIsAssignModalOpen}
        type="form"
        title="Assigner un livreur"
        description={
          selectedOrder
            ? `Commande #${selectedOrder.orderNumber?.split("-").pop()} — ${(selectedOrder as any).clientInfo?.firstName || selectedOrder.client?.firstName || ""} ${(selectedOrder as any).clientInfo?.lastName || selectedOrder.client?.lastName || ""}`
            : ""
        }
        icon={<Truck className="h-6 w-6 text-[#C5A065]" />}
        actions={{
          primary: {
            label: "Assigner",
            onClick: handleAssignDriver,
            disabled: !selectedDriver,
          },
          secondary: {
            label: "Annuler",
            onClick: () => {
              setIsAssignModalOpen(false);
              setSelectedOrder(null);
            },
          },
        }}
      >
        <div className="space-y-4">
          {selectedOrder?.deliveryAddress && (
            <div className="bg-stone-50 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-[#C5A065] mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-[#2D2A26]">Adresse de livraison</p>
                  <p className="text-sm text-stone-600">{selectedOrder.deliveryAddress.street}</p>
                  <p className="text-sm text-stone-600">
                    {selectedOrder.deliveryAddress.city}, {selectedOrder.deliveryAddress.province} {selectedOrder.deliveryAddress.postalCode}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-stone-500 mb-3 block">
              Choisir un livreur
            </label>
            {drivers.length === 0 ? (
              <p className="text-sm text-stone-400 italic">Aucun livreur disponible. Ajoutez des utilisateurs avec le rôle "Livreur".</p>
            ) : (
              <div className="space-y-2">
                {drivers.map((driver) => (
                  <button
                    key={driver.id}
                    onClick={() => setSelectedDriver(driver.id)}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${
                      selectedDriver === driver.id
                        ? "border-[#C5A065] bg-[#C5A065]/5"
                        : "border-stone-200 hover:border-stone-300"
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-[#C5A065]/10 flex items-center justify-center">
                      <User size={20} className="text-[#C5A065]" />
                    </div>
                    <div className="text-left flex-1">
                      <p className="font-medium text-[#2D2A26]">{driver.name}</p>
                      <p className="text-xs text-stone-500">{driver.phone || driver.email}</p>
                    </div>
                    {selectedDriver === driver.id && (
                      <CheckCircle className="w-5 h-5 text-[#C5A065]" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Details Modal */}
      <Modal
        open={isDetailsModalOpen}
        onOpenChange={setIsDetailsModalOpen}
        type="details"
        title="Détails de la commande"
        description=""
        icon={<Eye className="h-6 w-6 text-[#C5A065]" />}
        actions={{
          secondary: {
            label: "Fermer",
            onClick: () => {
              setIsDetailsModalOpen(false);
              setSelectedOrder(null);
            },
          },
        }}
      >
        {selectedOrder && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-stone-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <User size={16} className="text-[#C5A065]" />
                  <span className="text-xs font-bold uppercase text-stone-500">Client</span>
                </div>
                <p className="font-medium text-[#2D2A26]">
                  {(selectedOrder as any).clientInfo?.firstName || selectedOrder.client?.firstName} {(selectedOrder as any).clientInfo?.lastName || selectedOrder.client?.lastName}
                </p>
                <p className="text-sm text-stone-600">{(selectedOrder as any).clientInfo?.phone || selectedOrder.client?.phone}</p>
                <p className="text-sm text-stone-600">{(selectedOrder as any).clientInfo?.email || selectedOrder.client?.email}</p>
              </div>

              <div className="bg-stone-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar size={16} className="text-[#C5A065]" />
                  <span className="text-xs font-bold uppercase text-stone-500">Livraison</span>
                </div>
                <p className="font-medium text-[#2D2A26]">
                  {formatDate((selectedOrder as any).deliveryDate || selectedOrder.pickupDate || selectedOrder.orderDate)}
                </p>
                {selectedOrder.deliverySlot && (
                  <p className="text-sm text-stone-600">{selectedOrder.deliverySlot}</p>
                )}
              </div>
            </div>

            {selectedOrder.deliveryAddress && (
              <div className="bg-stone-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <MapPinned size={16} className="text-[#C5A065]" />
                  <span className="text-xs font-bold uppercase text-stone-500">Adresse</span>
                </div>
                <p className="text-sm text-[#2D2A26]">{selectedOrder.deliveryAddress.street}</p>
                <p className="text-sm text-stone-600">
                  {selectedOrder.deliveryAddress.city}, {selectedOrder.deliveryAddress.province} {selectedOrder.deliveryAddress.postalCode}
                </p>
              </div>
            )}

            <div className="bg-stone-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Package size={16} className="text-[#C5A065]" />
                <span className="text-xs font-bold uppercase text-stone-500">
                  Articles ({selectedOrder.items.length})
                </span>
              </div>
              <div className="space-y-1">
                {selectedOrder.items.map((item: any, idx: number) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <span className="text-[#2D2A26]">
                      {item.productName || item.product?.name || `Produit #${item.productId}`} x{item.quantity}
                    </span>
                    <span className="text-stone-600">{formatCurrency(item.amount || item.subtotal || item.unitPrice * item.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between font-bold text-[#2D2A26] mt-3 pt-3 border-t border-stone-200">
                <span>Total</span>
                <span>{formatCurrency(selectedOrder.total)}</span>
              </div>
            </div>

            {selectedOrder.notes && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-xs font-bold uppercase text-amber-600 mb-1">Notes</p>
                <p className="text-sm text-amber-800">{selectedOrder.notes}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
