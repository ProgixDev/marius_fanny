import { useState, useEffect } from "react";
import {
  Plus,
  Search,
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  XCircle,
  CheckCircle,
  Clock,
  Package,
  Truck,
  Calendar,
  Mail,
  Phone,
  MapPin,
  UserCircle,
  DollarSign,
  Check,
  Printer,
  Undo2,
  Bell,
  RefreshCw,
  AlertTriangle,
  Download,
  Tag,
  Monitor,
  Home,
  Store,
  Send,
} from "lucide-react";
import { DataTable } from "./ui/DataTable";
import { Modal } from "./ui/modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import OrderForm from "./OrderForm";
import OrderChangeHistory from "./OrderChangeHistory";
import { orderAPI } from "../lib/OrderAPI";
import { normalizedApiUrl } from "../lib/AuthClient";
import { clientAPI } from "../lib/ClientAPI";
import type { Order } from "../types";

interface OrderItemWithPacking {
  id: number;
  productId: number;
  product?: { id: number; name: string; price: number };
  quantity: number;
  unitPrice: number;
  subtotal: number;
  taxable?: boolean;
  productionStatus: string;
  notes?: string;
  selectedOptions?: Record<string, string>;
  isPacked?: boolean;
}

interface OrderWithPacking extends Omit<Order, 'items'> {
  items: OrderItemWithPacking[];
  paymentMethod?: "in_store" | "payment_link";
  paymentLinkChannel?: "email" | "sms";
  squarePaymentId?: string;
  squareInvoiceId?: string;
}

const buildOrderItemsUpdatePayload = (items: OrderItemWithPacking[]) =>
  items.map((item) => ({
    productId: item.productId,
    productName: item.product?.name ?? `Produit #${item.productId}`,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: item.subtotal,
    taxable: item.taxable,
    notes: item.notes,
    selectedOptions:
      item.selectedOptions && Object.keys(item.selectedOptions).length > 0
        ? item.selectedOptions
        : undefined,
    productionStatus:
      item.productionStatus === "ready" || item.productionStatus === "in_progress"
        ? item.productionStatus
        : "pending",
  }));

export function OrderManagement() {
  const [orders, setOrders] = useState<OrderWithPacking[]>([]);

  const [filteredOrders, setFilteredOrders] = useState<OrderWithPacking[]>(orders);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedOrderForProducts, setSelectedOrderForProducts] = useState<OrderWithPacking | null>(null);
  const [isProductsModalOpen, setIsProductsModalOpen] = useState(false);
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithPacking | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<OrderWithPacking | null>(null);
  const [orderToCancel, setOrderToCancel] = useState<OrderWithPacking | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editNotification, setEditNotification] = useState<{ type: "balance" | "refund" | "nochange"; amount: number; clientName: string } | null>(null);
  const [balancePaymentModal, setBalancePaymentModal] = useState<{ open: boolean; order: OrderWithPacking | null; amount: number; clientName: string }>({ open: false, order: null, amount: 0, clientName: "" });
  const [isSendingBalanceLink, setIsSendingBalanceLink] = useState(false);
  const [viewMode, setViewMode] = useState<"simple" | "complete">("simple");
  const [refundEmployeeName, setRefundEmployeeName] = useState<string>("");
  const [balanceRefundOrder, setBalanceRefundOrder] = useState<OrderWithPacking | null>(null);
  const [balanceRefundEmployee, setBalanceRefundEmployee] = useState("");
  const [isBalanceRefundModalOpen, setIsBalanceRefundModalOpen] = useState(false);
  const [storeRefundOrder, setStoreRefundOrder] = useState<OrderWithPacking | null>(null);
  const [storeRefundEmployee, setStoreRefundEmployee] = useState("");
  const [storeRefundReason, setStoreRefundReason] = useState("");
  const [isStoreRefundModalOpen, setIsStoreRefundModalOpen] = useState(false);
  const [isProcessingStoreRefund, setIsProcessingStoreRefund] = useState(false);
  const [isProcessingReminders, setIsProcessingReminders] = useState(false);
  const [reminderResult, setReminderResult] = useState<{
    success: boolean;
    message: string;
    summary?: {
      totalOrders: number;
      remindersSentWeek: number;
      remindersSent48h: number;
      remindersSentOverdue: number;
      ordersCancelled: number;
      errors: number;
    };
  } | null>(null);

  const isArchivedStatus = (status: OrderWithPacking["status"]) =>
    status === "completed" || status === "delivered";

  const applyOrderFilters = (list: OrderWithPacking[]) => {
    let next = list;

    if (!showArchived) {
      next = next.filter((order) => !isArchivedStatus(order.status));
    }

    if (selectedDate) {
      next = next.filter((order) => {
        const raw = String(
          order.pickupDate ||
            (order as any).deliveryDate ||
            order.orderDate ||
            order.createdAt ||
            ""
        );
        const dateKey = raw.includes("T") ? raw.split("T")[0] : raw.slice(0, 10);
        return dateKey === selectedDate;
      });
    }

    return next;
  };

  // Filtrer par date + archivage (ramassées/terminées)
  useEffect(() => {
    setFilteredOrders(applyOrderFilters(orders));
  }, [selectedDate, showArchived, orders]);

  // Charger les commandes depuis l'API au montage
  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const limit = 100;
        const maxPages = 20; // safety cap (up to 2000 orders)
        let page = 1;
        let items: any[] = [];

        while (page <= maxPages) {
          const res = await orderAPI.getOrders({ page, limit });
          const pageItems = res.data?.items || [];
          items = items.concat(pageItems);

          const totalPages = Number(res.data?.pagination?.totalPages || 0);
          if (totalPages > 0) {
            if (page >= totalPages) break;
          } else if (pageItems.length < limit) {
            break;
          }

          page += 1;
        }
        
        if (items.length > 0) {
          // Debug: log billing info for all government orders
          const govOrders = items.filter((o: any) => o.billingKind === "gouvernement");
          if (govOrders.length > 0) {
            console.log("📦 Government orders from API:", govOrders.map((o: any) => ({
              orderNumber: o.orderNumber,
              billingKind: o.billingKind,
              paymentDueDate: o.paymentDueDate,
              paymentStatus: o.paymentStatus
            })));
          }
          
          const mapped: OrderWithPacking[] = items.map((o: any) => {
            const mappedSource: OrderWithPacking["source"] =
              o.source === "online" || o.source === "phone" || o.source === "in_store"
                ? o.source
                : "in_store";

            const mappedPaymentMethod: NonNullable<OrderWithPacking["paymentMethod"]> =
              o.paymentMethod === "in_store" || o.paymentMethod === "payment_link"
                ? o.paymentMethod
                : o.paymentType === "full"
                  ? "in_store"
                  : o.paymentType === "deposit"
                    ? "payment_link"
                    : o.squarePaymentId || o.squareInvoiceId
                      ? "payment_link"
                      : "in_store";

            // S'assurer que les items ont des produits avec des noms
            const orderItems = (o.items || []).map((item: any, idx: number) => {
              let productName = `Produit #${item.productId}`; // Nom par defaut
              let productPrice = item.unitPrice || 0;
              if (item.product) {
                productName = item.product.name || productName;
                productPrice = item.product.price || productPrice;
              } else if (item.productName) {
                productName = item.productName;
              }
              
              return {
                id: idx + 1,
                orderId: 0,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                subtotal: item.amount || (item.quantity * item.unitPrice),
                productionStatus: item.productionStatus || "pending",
                notes: item.notes,
                selectedOptions:
                  item.selectedOptions && Object.keys(item.selectedOptions).length > 0
                    ? item.selectedOptions
                    : undefined,
                product: {
                  id: item.productId,
                  name: productName,
                  price: productPrice
                },
                isPacked: item.productionStatus === "ready" || item.isPacked === true
              };
            });

              return {
                id: o._id || o.id,
                orderNumber: o.orderNumber || "",
                clientId: 0,
              client: {
                id: 0,
                firstName: o.clientInfo?.firstName || "",
                lastName: o.clientInfo?.lastName || "",
                email: o.clientInfo?.email || "",
                phone: o.clientInfo?.phone || "",
                status: "active" as const,
                createdAt: o.createdAt,
                updatedAt: o.updatedAt,
                addresses: [],
                orders: [],
              },
              orderDate: o.orderDate || o.createdAt,
              pickupDate:
                o.pickupDate ||
                (o.deliveryType === "pickup" && o.deliveryDate
                  ? (() => {
                      const datePart = String(o.deliveryDate).split("T")[0];
                      const timeRaw = String(o.deliveryTimeSlot || "00:00").trim();
                      const timePart = /^([01]\d|2[0-3]):[0-5]\d$/.test(timeRaw)
                        ? timeRaw
                        : "00:00";
                      const parsed = new Date(`${datePart}T${timePart}:00`);
                      if (Number.isNaN(parsed.getTime())) return o.createdAt || o.orderDate;
                      return parsed.toISOString();
                    })()
                  : o.createdAt),
              pickupLocation: o.pickupLocation || "Laval",
              deliveryType: o.deliveryType || "pickup",
              deliveryDate: o.deliveryDate,
              deliveryTimeSlot: o.deliveryTimeSlot,
              deliveryAddress: o.deliveryAddress,
              items: orderItems,
              subtotal: o.subtotal || 0,
              taxAmount: o.taxAmount || 0,
              deliveryFee: o.deliveryFee || 0,
              total: o.total || 0,
              depositAmount: o.depositAmount || 0,
              depositPaid: o.depositPaid || false,
              depositPaidAt: o.depositPaidAt,
              balancePaid: o.balancePaid || false,
              balancePaidAt: o.balancePaidAt,
              squarePaymentId: o.squarePaymentId,
              squareInvoiceId: o.squareInvoiceId,
              paymentStatus: o.paymentStatus || "unpaid",
              refunds: o.refunds || undefined,
              billingKind: o.billingKind,
              billingOrganization: o.billingOrganization,
              paymentDueDate: o.paymentDueDate,
              status: o.status || "pending",
              source: mappedSource,
              paymentMethod: mappedPaymentMethod,
              paymentLinkChannel: o.paymentLinkChannel || "email",
              notes: o.notes,
              changeHistory: o.changeHistory,
              amountPaid: o.amountPaid ?? 0,
              createdAt: o.createdAt,
              updatedAt: o.updatedAt,
            };
          });

          setOrders(mapped);
          setFilteredOrders(applyOrderFilters(mapped));
        }
      } catch (err) {
        console.error("Failed to fetch orders:", err);
      }
    };

    fetchOrders();
  }, []);

  // Charger les clients depuis l'API
  const [clientsList, setClientsList] = useState<any[]>([]);
  const fetchClients = async () => {
    try {
      const data = await clientAPI.getClients(1, 100);
      setClientsList(data.clients);
    } catch (err) {
      console.error("Failed to fetch clients:", err);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  // Only real clients from the API should appear in the selectable client list.
  const clients = clientsList;
  const getOrderColor = (order: OrderWithPacking) => {
    if (order.status === "completed") {
      return "!bg-green-50 border-l-4 !border-l-green-500 hover:!bg-green-100 cursor-pointer";
    }
    if (order.pickupLocation === "Montreal" && order.deliveryType === "pickup") {
      return "!bg-blue-50 border-l-4 !border-l-blue-500 hover:!bg-blue-100 cursor-pointer";
    } else if (order.deliveryType === "delivery") {
      return "!bg-yellow-50 border-l-4 !border-l-yellow-500 hover:!bg-yellow-100 cursor-pointer";
    } else if (order.pickupLocation === "Laval" && order.deliveryType === "pickup") {
      return "!bg-white border-l-4 !border-l-gray-300 hover:!bg-gray-50 cursor-pointer";
    }
    return "!bg-white hover:!bg-gray-50 cursor-pointer";
  };

  const getStatusBadge = (status: Order["status"]) => {
    const statusConfig = {
      pending: {
        label: "En attente",
        className: "bg-yellow-100 text-yellow-800",
      },
      confirmed: {
        label: "Confirmee",
        className: "bg-blue-100 text-blue-800",
      },
      in_production: {
        label: "En production",
        className: "bg-purple-100 text-purple-800",
      },
      ready: { label: "Prete", className: "bg-green-100 text-green-800" },
      completed: {
        label: "Ramassee",
        className: "bg-green-100 text-green-800",
      },
      cancelled: { label: "Annulee", className: "bg-red-100 text-red-800" },
    };

    const config = statusConfig[status];
    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-medium ${config.className}`}
      >
        {config.label}
      </span>
    );
  };

  const getPaymentBadge = (paymentStatus: Order["paymentStatus"], order?: OrderWithPacking) => {
    const hasRefunds = order && (order as any).refunds?.length > 0;
    const paidAmount = (order as any)?.amountPaid || 0;
    const total = order?.total || 0;
    const fullyPaid = !total || paidAmount + 0.01 >= total;

    // ── Cancelled orders ──────────────────────────────────────────────────
    // Cancellation is a stronger signal than payment status: even if the order
    // shows paymentStatus=paid (e.g. "Marquer payé" then "Annuler la commande"),
    // the money owed to the client hasn't actually been returned, so we surface
    // "À rembourser" until a refund entry exists.
    //
    // The one exception is the "refund then re-mark paid" workflow: the admin
    // explicitly chose to override a recorded refund (refund was a mistake, or
    // client paid again in cash). hasRefunds + paymentStatus=paid + fullyPaid
    // means we trust that admin override and go green.
    if (order && order.status === "cancelled") {
      if (hasRefunds && paymentStatus === "paid" && fullyPaid) {
        return (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            Payé
          </span>
        );
      }
      if (hasRefunds) {
        return (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
            Remboursé
          </span>
        );
      }
      const wasPaid =
        paymentStatus === "paid" ||
        paymentStatus === "deposit_paid" ||
        order.depositPaid === true ||
        paidAmount > 0.01;
      if (wasPaid) {
        return (
          <span className="px-2 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-800">
            À rembourser
          </span>
        );
      }
      // Cancelled and never paid — fall through to the default unpaid badge.
    }

    // ── Active orders ─────────────────────────────────────────────────────
    // Explicit "Marquer payé" after a refund on a NON-cancelled order also
    // counts as an admin override → "Payé".
    if (paymentStatus === "paid" && fullyPaid) {
      return (
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
          Payé
        </span>
      );
    }

    if (hasRefunds) {
      return (
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
          Remboursé
        </span>
      );
    }

    // If order has partial payment with balance remaining, show "Balance à payer: X$"
    if (order) {
      const paidAmount = (order as any).amountPaid || 0;
      const balance = (order.total || 0) - paidAmount;
      if (balance > 0.01 && paidAmount > 0.01) {
        return (
          <span className="px-2 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-800">
            Balance: {balance.toFixed(2)}$
          </span>
        );
      }
    }

    // In-store refund badge — refunds[] entry without paymentId means it
    // wasn't refunded through Square, but recorded as cash/debit at the counter.
    if (order && Array.isArray((order as any).refunds)) {
      const inStoreRefund = ((order as any).refunds as any[]).find(
        (r) => r && !r.paymentId,
      );
      if (inStoreRefund) {
        const who = String(inStoreRefund.employeeName || "").trim();
        return (
          <span
            className="px-2 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800"
            title={
              inStoreRefund.reason ||
              `Remboursé via magasin par ${who || "?"}`
            }
          >
            Remboursé via magasin{who ? ` par ${who}` : ""}
          </span>
        );
      }
    }

    const paymentConfig = {
      unpaid: { label: "Non payé", className: "bg-red-100 text-red-800" },
      deposit_paid: {
        label: "Dépôt payé",
        className: "bg-yellow-100 text-yellow-800",
      },
      paid: { label: "Payé", className: "bg-green-100 text-green-800" },
    };

    const config = paymentConfig[paymentStatus];
    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-medium ${config.className}`}
      >
        {config.label}
      </span>
    );
  };

  const getPaymentChannelIcon = (order: OrderWithPacking) => {
    // Show icon as long as SOMETHING has been paid (amountPaid > 0 OR depositPaid OR paid status)
    const hasSomePayment =
      order.paymentStatus === "paid" ||
      order.paymentStatus === "deposit_paid" ||
      order.depositPaid ||
      ((order as any).amountPaid || 0) > 0;
    if (!hasSomePayment) return null;

    const paidViaBoutique = order.source === "online";
    if (paidViaBoutique) {
      return (
        <span
          title="Payé via boutique"
          className="inline-flex items-center justify-center rounded-full bg-emerald-200 text-emerald-900 p-1"
        >
          <Home className="h-4 w-4" />
        </span>
      );
    }

    const paidViaSquareLink =
      order.paymentMethod === "payment_link" ||
      Boolean(order.squarePaymentId || order.squareInvoiceId);

    if (paidViaSquareLink) {
      return (
        <span
          title="Payé via lien Square"
          className="inline-flex items-center justify-center rounded-full bg-blue-100 text-blue-700 p-1"
        >
          <Monitor className="h-3.5 w-3.5" />
        </span>
      );
    }

    return (
      <span
        title="Payé via boutique"
        className="inline-flex items-center justify-center rounded-full bg-emerald-200 text-emerald-900 p-1"
      >
        <Home className="h-4 w-4" />
      </span>
    );
  };

  const getPaymentDueDateForOrder = (order: any): Date | null => {
    // Only show date limit for unpaid orders
    // Check both paymentStatus and depositPaid to handle all cases
    const isPaid = order?.paymentStatus === "paid" || order?.depositPaid === true;
    if (isPaid) return null;
    
    // For government clients: show due date (from DB or calculate 60 days)
    if (order?.billingKind === "gouvernement") {
      if (order?.paymentDueDate) {
        return new Date(order.paymentDueDate);
      }
      // Calculate 60 days from order date
      const base = new Date(order.orderDate || order.createdAt);
      const due = new Date(base);
      due.setDate(due.getDate() + 60);
      return due;
    }
    
    // For representative clients: payment due on delivery/pickup date
    // If no delivery/pickup date is set, use order date (same day payment)
    if (order?.billingKind === "representant") {
      if (order.pickupDate) {
        return new Date(order.pickupDate);
      }
      if (order.deliveryDate) {
        return new Date(order.deliveryDate);
      }
      // For same-day payment, return order date (payment should be made now)
      const base = new Date(order.orderDate || order.createdAt);
      return base;
    }
    
    // For other clients with payment due date
    if (order?.paymentDueDate) return new Date(order.paymentDueDate);
    return null;
  };

  const isGovernmentLate = (order: any) => {
    if (order?.billingKind !== "gouvernement") return false;
    if (order?.paymentStatus === "paid") return false;
    const base = new Date(order.orderDate || order.createdAt);
    const daysOpen = Math.floor((Date.now() - base.getTime()) / (1000 * 60 * 60 * 24));
    return daysOpen >= 60;
  };

  const formatDateOnly = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("fr-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("fr-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Format the column "Heure de ramassage / livraison" so it ALWAYS shows
  // the scheduled service date+time, never the order creation timestamp.
  const formatServiceTime = (order: OrderWithPacking) => {
    // 1. Extract a date string YYYY-MM-DD: prefer deliveryDate (saved as a
    //    plain string), then derive from pickupDate in Toronto timezone.
    let dateStr = "";
    if (order.deliveryDate && String(order.deliveryDate).trim()) {
      dateStr = String(order.deliveryDate).slice(0, 10);
    } else if (order.pickupDate) {
      try {
        dateStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Toronto",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(order.pickupDate));
      } catch {
        /* ignore */
      }
    }

    // 2. Extract a time: prefer the saved slot string, otherwise pull
    //    HH:MM from pickupDate in Toronto.
    let timeStr = "";
    if (order.deliveryTimeSlot && order.deliveryTimeSlot.trim()) {
      timeStr = order.deliveryTimeSlot.trim();
    } else if (order.pickupDate) {
      try {
        const hhmm = new Intl.DateTimeFormat("fr-CA", {
          timeZone: "America/Toronto",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(order.pickupDate));
        if (hhmm && hhmm !== "00:00") timeStr = hhmm;
      } catch {
        /* ignore */
      }
    }

    if (!dateStr && !timeStr) return "—";

    // 3. Pretty-print the date as "1 mai 2026"
    const prettyDate = dateStr
      ? new Date(`${dateStr}T12:00:00`).toLocaleDateString("fr-CA", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "";

    if (prettyDate && timeStr) return `${prettyDate} (${timeStr})`;
    return prettyDate || timeStr;
  };

  const parseItemNotes = (notes?: string) => {
    if (!notes) return { options: [] as string[], allergies: "", note: "", description: "" };

    const lines = notes
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const optionsLine = lines.find((line) => line.toLowerCase().startsWith("options:"));
    const allergiesLine = lines.find((line) => line.toLowerCase().startsWith("allergies:"));
    const noteLine = lines.find((line) => line.toLowerCase().startsWith("note:"));
  const descriptionLine = lines.find((line) => line.toLowerCase().startsWith("description:"));

    const options = optionsLine
      ? optionsLine
          .replace(/^options:\s*/i, "")
          .split("|")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [];

    const allergies = allergiesLine
      ? allergiesLine.replace(/^allergies:\s*/i, "").trim()
      : "";

    const fallbackLines = lines.filter(
      (line) =>
        !line.toLowerCase().startsWith("options:") &&
        !line.toLowerCase().startsWith("allergies:") &&
        !line.toLowerCase().startsWith("note:"),
    );

    const note = noteLine
      ? noteLine.replace(/^note:\s*/i, "").trim()
      : fallbackLines.join(" ");

    const description = descriptionLine
      ? descriptionLine.replace(/^description:\s*/i, "").trim()
      : "";

    return { options, allergies, note, description };
  };

  const formatSelectedOptions = (selectedOptions?: Record<string, string>) => {
    if (!selectedOptions) return [] as string[];
    return Object.entries(selectedOptions)
      .map(([key, value]) => [String(key).trim(), String(value).trim()] as const)
      .filter(([key, value]) => key && value)
      .map(([key, value]) => `${key}: ${value}`);
  };

  const getItemOptionChips = (item: Pick<OrderItemWithPacking, "notes" | "selectedOptions">) => {
    const parsed = parseItemNotes(item.notes);
    const combined = [...formatSelectedOptions(item.selectedOptions), ...parsed.options];
    const chips = Array.from(new Set(combined)).filter(Boolean);
    // If notes are like "Pain: Baguette | Tranché: Oui" (web orders), treat them as options too.
    if (chips.length === 0 && item.notes && item.notes.includes("|")) {
      const fromNotes = item.notes
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      return { chips: Array.from(new Set(fromNotes)), parsed };
    }
    return { chips, parsed };
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("fr-CA", {
      style: "currency",
      currency: "CAD",
    }).format(amount);
  };

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

  const getOrderDisplayNumber = (order: OrderWithPacking) => {
    const shortNumber = formatOrderNumber(order.orderNumber);
    return shortNumber;
  };

  const generateFallbackOrderNumber = (isoDate: string) => {
    const datePart = isoDate.slice(0, 10).replace(/-/g, "");
    const prefix = `MF-${datePart}-`;
    const nextSequence = orders.filter((order) => order.orderNumber.startsWith(prefix)).length + 1;
    return `${prefix}${String(nextSequence).padStart(4, "0")}`;
  };

  // Fonction pour voir les produits d'une commande
  const handleViewProducts = (order: OrderWithPacking) => {
    console.log("Ouverture des produits pour:", order.orderNumber);
    setSelectedOrderForProducts(order);
    setIsProductsModalOpen(true);
  };

  // Fonction pour emballer un produit
  const handlePackItem = async (orderId: string, itemId: number) => {
    // Compute new state synchronously before calling setOrders
    const currentOrder = orders.find((o) => o.id === orderId);
    if (!currentOrder) return;

    const updatedItems = currentOrder.items.map((item) =>
      item.id === itemId ? { ...item, isPacked: true, productionStatus: "ready" } : item,
    );
    const allPacked = updatedItems.every((item) => item.productionStatus === "ready");
    const newStatus = (allPacked ? "ready" : currentOrder.status) as OrderWithPacking["status"];

    const updatedOrder: OrderWithPacking = {
      ...currentOrder,
      items: updatedItems,
      status: newStatus,
    };

    // Update local state
    setOrders((prevOrders) =>
      prevOrders.map((order) => (order.id === orderId ? updatedOrder : order)),
    );

    // Keep modal state in sync with the source of truth to prevent visual rollback.
    if (selectedOrderForProducts?.id === orderId) {
      setSelectedOrderForProducts(updatedOrder);
    }

    try {
      const result = await orderAPI.updateOrder(orderId, {
        items: buildOrderItemsUpdatePayload(updatedItems),
        ...(allPacked && currentOrder.status !== "ready" ? { status: "ready" } : {}),
      });
      console.log("✅ Emballage sauvegardé:", result);
    } catch (err: any) {
      console.error("❌ Failed to persist packed item:", err);
      alert(`Erreur lors de la sauvegarde de l'emballage: ${err.message || err}`);
    }
  };

  // Fonction pour désemballer un produit (revenir en arrière)
  const handleUnpackItem = async (orderId: string, itemId: number) => {
    const currentOrder = orders.find((o) => o.id === orderId);
    if (!currentOrder) return;

    const updatedItems = currentOrder.items.map((item) =>
      item.id === itemId ? { ...item, isPacked: false, productionStatus: "pending" } : item,
    );
    // If order was "ready" because all items were packed, revert to in_production
    const wasAllPacked = currentOrder.items.every((item) => item.productionStatus === "ready");
    const newStatus = (wasAllPacked && currentOrder.status === "ready" ? "in_production" : currentOrder.status) as OrderWithPacking["status"];

    const updatedOrder: OrderWithPacking = {
      ...currentOrder,
      items: updatedItems,
      status: newStatus,
    };

    setOrders((prevOrders) =>
      prevOrders.map((order) => (order.id === orderId ? updatedOrder : order)),
    );

    if (selectedOrderForProducts?.id === orderId) {
      setSelectedOrderForProducts(updatedOrder);
    }

    try {
      const result = await orderAPI.updateOrder(orderId, {
        items: buildOrderItemsUpdatePayload(updatedItems),
        ...(wasAllPacked && currentOrder.status === "ready"
          ? { status: "in_production" }
          : {}),
      });
      console.log("✅ Désemballage sauvegardé:", result);
    } catch (err: any) {
      console.error("❌ Failed to persist unpacked item:", err);
      alert(`Erreur lors de la sauvegarde de l'emballage: ${err.message || err}`);
    }
  };

  const handleViewDetails = (order: OrderWithPacking) => {
    setSelectedOrder(order);
    setIsDetailsModalOpen(true);
  };

  const handleEdit = (order: OrderWithPacking) => {
    setSelectedOrder(order);
    setIsEditModalOpen(true);
  };

  const handleDeleteClick = (order: OrderWithPacking) => {
    setOrderToDelete(order);
    setIsDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    if (!orderToDelete) return;

    setIsSubmitting(true);
    try {
      // If order has a pending Square invoice, cancel it first
      if (orderToDelete.squareInvoiceId && orderToDelete.paymentStatus !== "paid") {
        try {
          await fetch(`${normalizedApiUrl}/api/payments/cancel-invoice`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ orderId: orderToDelete.id }),
          });
        } catch (e) {
          console.warn("Failed to cancel Square invoice:", e);
        }
      }
      await orderAPI.deleteOrder(orderToDelete.id);
      const newOrders = orders.filter((o) => o.id !== orderToDelete.id);
      setOrders(newOrders);
      setFilteredOrders(applyOrderFilters(newOrders));
      setIsDeleteModalOpen(false);
      setOrderToDelete(null);
    } catch (err: any) {
      console.error("❌ Failed to delete order:", err);
      alert(`Erreur lors de la suppression: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProcessReminders = async () => {
    setIsProcessingReminders(true);
    setReminderResult(null);
    
    try {
      const response = await fetch(`${normalizedApiUrl}/api/payment-reminders/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });
      
      const data = await response.json();
      setReminderResult(data);
      
      // Note: Orders will be updated automatically when the status changes
      // The admin can manually refresh the page to see updated statuses
    } catch (err: any) {
      console.error("❌ Failed to process reminders:", err);
      setReminderResult({
        success: false,
        message: `Erreur: ${err.message || err}`,
      });
    } finally {
      setIsProcessingReminders(false);
    }
  };

  const handleRefundClick = (order: OrderWithPacking) => {
    setRefundEmployeeName("");
    setOrderToCancel(order);
    setIsCancelModalOpen(true);
  };

  const handleRefund = async () => {
    if (!orderToCancel) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`${normalizedApiUrl}/api/payments/refund-order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          orderId: orderToCancel.id,
          reason: `Remboursement admin pour commande ${orderToCancel.orderNumber}`,
          employeeName: refundEmployeeName.trim(),
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Echec du remboursement Square");
      }

      const refundEntry = result?.data?.refundEntry
        ? {
            ...result.data.refundEntry,
            refundedAt: String(
              result.data.refundEntry.refundedAt || new Date().toISOString(),
            ),
          }
        : {
            refundedAt: new Date().toISOString(),
            employeeName: refundEmployeeName.trim(),
            employeeId: undefined,
            paymentId: result?.data?.paymentId || "",
            refundId: result?.data?.refundId,
            refundStatus: result?.data?.refundStatus,
            amountCents: Number(result?.data?.refundAmountCents || 0),
            reason: `Remboursement admin pour commande ${orderToCancel.orderNumber}`,
          };

      const updatedOrders: OrderWithPacking[] = orders.map((o) => {
        if (o.id !== orderToCancel.id) return o;
        const nextRefunds = [...((o as any).refunds || [])];
        if (refundEntry && refundEntry.employeeName) nextRefunds.push(refundEntry);
        return {
          ...o,
          status: "cancelled",
          paymentStatus: "unpaid",
          balancePaid: false,
          refunds: nextRefunds,
        };
      });
      setOrders(updatedOrders);
      setFilteredOrders(applyOrderFilters(updatedOrders));
      if (selectedOrder?.id === orderToCancel.id) {
        const nextSelected = updatedOrders.find((o) => o.id === orderToCancel.id);
        if (nextSelected) setSelectedOrder(nextSelected);
      }
      setIsCancelModalOpen(false);
      setOrderToCancel(null);
    } catch (err: any) {
      console.error("❌ Failed to refund order:", err);
        setRefundEmployeeName("");
      alert(`Erreur lors du remboursement: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Re-sync an order's payment status with Square's actual refund state.
  // Fixes orders that were refunded on Square but still show "Payé" in the app.
  const handleReconcileRefund = async (order: OrderWithPacking) => {
    try {
      const response = await fetch(`${normalizedApiUrl}/api/payments/reconcile-refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ orderId: order.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Échec de la synchronisation");
      }

      if (!result.data?.changed && result.changed !== true) {
        alert(result.message || "Aucun remboursement trouvé sur Square pour cette commande.");
        return;
      }

      const updatedOrders = orders.map((o) =>
        o.id === order.id
          ? {
              ...o,
              status: (result.data?.status as OrderWithPacking["status"]) || "cancelled",
              paymentStatus: (result.data?.paymentStatus as OrderWithPacking["paymentStatus"]) || "unpaid",
              refunds: (o as any).refunds && (o as any).refunds.length > 0
                ? (o as any).refunds
                : [{ refundedAt: new Date().toISOString(), employeeName: "Synchronisation Square", refundStatus: "completed", amountCents: Math.round((result.data?.refundedDollars || 0) * 100) }],
            }
          : o,
      );
      setOrders(updatedOrders);
      setFilteredOrders(applyOrderFilters(updatedOrders));
      if (selectedOrder?.id === order.id) {
        const next = updatedOrders.find((o) => o.id === order.id);
        if (next) setSelectedOrder(next);
      }
      alert("✅ Statut synchronisé : la commande est maintenant marquée remboursée.");
    } catch (err: any) {
      console.error("❌ Failed to reconcile refund:", err);
      alert(`Erreur lors de la synchronisation: ${err.message || err}`);
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: OrderWithPacking["status"]) => {
    // If cancelling and there's a pending Square invoice, cancel it too
    if (newStatus === "cancelled") {
      const targetOrder = orders.find((o) => o.id === orderId);
      if (targetOrder?.squareInvoiceId && targetOrder.paymentStatus !== "paid") {
        try {
          await fetch(`${normalizedApiUrl}/api/payments/cancel-invoice`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ orderId }),
          });
        } catch (e) {
          console.warn("Failed to cancel Square invoice:", e);
        }
      }
    }

    const updatedOrders: OrderWithPacking[] = orders.map((o) =>
      o.id === orderId ? { ...o, status: newStatus } : o,
    );
    setOrders(updatedOrders);
    setFilteredOrders(applyOrderFilters(updatedOrders));

    // Persist status change to the backend
    try {
      await orderAPI.updateOrder(orderId, { status: newStatus });
    } catch (err: any) {
      console.error("❌ Failed to persist order status:", err);
      alert(`Erreur lors de la sauvegarde du statut: ${err.message || err}`);
    }
  };

  const handleMarkPaid = async (order: OrderWithPacking) => {
    const payload: any = {
      depositPaid: true,
      balancePaid: true,
      amountPaid: order.total,
    };

    // amountPaid must jump to total here, otherwise getPaymentBadge() still
    // computes a positive balance and shows the orange "Balance: X$" pill
    // instead of the green "Payé" pill.
    const updatedOrder: OrderWithPacking = {
      ...order,
      depositPaid: true,
      balancePaid: true,
      paymentStatus: "paid",
      amountPaid: order.total,
      depositPaidAt: order.depositPaidAt || new Date().toISOString(),
      balancePaidAt: new Date().toISOString(),
    };

    const updatedOrders = orders.map((o) => (o.id === order.id ? updatedOrder : o));
    setOrders(updatedOrders);
    setFilteredOrders(applyOrderFilters(updatedOrders));

    try {
      await orderAPI.updateOrder(order.id, payload);
    } catch (err: any) {
      console.error("❌ Failed to mark order as paid:", err);
      alert(`Erreur lors du marquage comme payé: ${err.message || err}`);
    }
  };

  // Export orders to Excel (.xlsx)
  const exportOrdersToExcel = async () => {
    const XLSX = await import("xlsx");

    // Format an item as a single readable line — product name only (no prices):
    //   "2x Croissant amandes (Grandeur: 6 personnes)"
    const formatItemLine = (item: any): string => {
      const product =
        item.product?.name ||
        item.productName ||
        (item.productId != null ? `Produit #${item.productId}` : "Produit");
      const qty = item.quantity ?? 1;
      const optsObj = item.selectedOptions || item.options || {};
      const opts = Object.entries(optsObj)
        .filter(([, v]) => String(v ?? "").trim().length > 0)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      return opts ? `${qty}x ${product} (${opts})` : `${qty}x ${product}`;
    };

    const data = filteredOrders.map((o) => {
      const items = Array.isArray(o.items) ? o.items : [];
      // Newline-separated so each item is on its own line in Excel cells
      // (Excel respects "\n" when wrap-text is on; default still readable).
      const articles = items.map(formatItemLine).join("\n");
      return {
        "Commande": formatOrderNumber(o.orderNumber),
        "Date": new Date(o.orderDate).toLocaleDateString("fr-CA"),
        "Client": `${o.client.firstName} ${o.client.lastName}`,
        "Email": o.client.email,
        "Téléphone": o.client.phone,
        "Type": o.deliveryType === "delivery" ? "Livraison" : `Ramassage ${o.pickupLocation}`,
        "Statut": o.status,
        "Paiement": o.paymentStatus,
        "Articles": articles,
        "Nb articles": items.reduce((s, it: any) => s + (it.quantity || 0), 0),
        "Sous-total": o.subtotal,
        "Taxes": o.taxAmount,
        "Livraison": o.deliveryFee,
        "Total": o.total,
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);

    // Set column widths so "Articles" is generously sized for readability
    const COL_WIDTHS: Record<string, number> = {
      Commande: 10,
      Date: 12,
      Client: 22,
      Email: 28,
      "Téléphone": 14,
      Type: 18,
      Statut: 14,
      Paiement: 14,
      Articles: 60,
      "Nb articles": 8,
      "Sous-total": 10,
      Taxes: 10,
      Livraison: 10,
      Total: 10,
    };
    (ws as any)["!cols"] = Object.keys(data[0] || {}).map((key) => ({
      wch: COL_WIDTHS[key] ?? 14,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Commandes");
    XLSX.writeFile(wb, `commandes_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // Print MUNBYN 4x6 thermal label for an order
  // Cloudinary URL with grayscale + high contrast for thermal printing
  // Cloudinary: grayscale + blackpoint to force pure black
  const labelLogoUrl = "https://res.cloudinary.com/deyjooxbi/image/upload/e_grayscale/e_contrast:100/e_brightness:-20/f_png/v1773330080/branding/marius_fanny_logo";

  const buildLabelHtml = (order: OrderWithPacking) => {
    const imgSrc = labelLogoUrl;
    const shortNumber = formatOrderNumber(order.orderNumber);
    const pickupDateObj = new Date(order.pickupDate || order.orderDate);
    const date = pickupDateObj.toLocaleDateString("fr-CA", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const time = order.deliveryTimeSlot || pickupDateObj.toLocaleTimeString("fr-CA", {
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const clientName = `${order.client.firstName} ${order.client.lastName}`;
    const items = order.items.map((item) => {
      const name = item.product?.name || `Produit #${item.productId}`;
      const options = item.selectedOptions
        ? Object.entries(item.selectedOptions).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ")
        : "";
      const notes = item.notes || "";
      return `<tr>
        <td style="padding:5px 0;font-size:16px;border-bottom:1px dashed #ccc;">${name} <strong>x${item.quantity}</strong></td>
      </tr>
      ${options ? `<tr><td style="padding:2px 0 5px 10px;font-size:14px;color:#333;">${options}</td></tr>` : ""}
      ${notes ? `<tr><td style="padding:2px 0 5px 10px;font-size:14px;color:#000;font-weight:bold;">${notes}</td></tr>` : ""}`;
    }).join("");

    const allergies = order.items
      .map((item: any) => {
        const fromOptions = Object.entries(item.selectedOptions || {})
          .filter(([k]) => k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("allerg"))
          .map(([, v]) => String(v).trim())
          .filter(Boolean);
        return fromOptions.length > 0 ? fromOptions.join(", ") : (item.allergies || "");
      })
      .filter(Boolean);
    const allergyHtml = allergies.length > 0
      ? `<div style="margin-top:10px;padding:8px;border:3px solid #000;font-size:16px;font-weight:900;text-align:center;">ALLERGIE: ${allergies.join(", ")}</div>`
      : "";

    // Header is `position: sticky` so the order number, name and date repeat
    // at the top of EVERY physical 4×6 sticker when one logical order
    // overflows to a second label (long carts). Items now flow naturally —
    // no more absolute bottom-positioned order number disappearing under
    // overflowed content, no more stacking onto the next order's sticker.
    return `
      <div class="label">
        <div class="label-header">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">
            <img src="${imgSrc}" alt="Marius & Fanny" style="height:36px;" />
            <div style="font-size:34px;font-weight:900;letter-spacing:2px;">#${shortNumber}</div>
          </div>
          <div style="font-size:14px;font-weight:bold;">${date} — ${time}</div>
          <div style="font-size:18px;font-weight:900;">${clientName}</div>
          ${order.deliveryType === "delivery" && order.deliveryAddress ? `
            <div style="font-size:12px;">
              ${order.deliveryAddress.street}, ${order.deliveryAddress.city} ${order.deliveryAddress.postalCode}
            </div>
          ` : `
            <div style="font-size:12px;">Ramassage: ${order.pickupLocation || ""}</div>
          `}
        </div>
        <table style="width:100%;border-collapse:collapse;">${items}</table>
        ${allergyHtml}
      </div>`;
  };

  // Common print styles. Key points:
  //  - `.label` is the per-order container, separated from the next order
  //    with `page-break-after: always`.
  //  - `.label-header` is sticky so on a long order that overflows past one
  //    4×6 sticker, the second physical page still shows order # + name
  //    at the top.
  //  - rows use `page-break-inside: avoid` so a single product line is
  //    never split across two stickers.
  const LABEL_STYLES = `
    @page { size: 4in 6in; margin: 0; }
    body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
    .label {
      width: 4in;
      padding: 10px 12px;
      box-sizing: border-box;
      page-break-after: always;
    }
    .label:last-child { page-break-after: auto; }
    .label-header {
      position: sticky;
      top: 0;
      background: white;
      padding-bottom: 6px;
      border-bottom: 1px solid #000;
      margin-bottom: 6px;
    }
    .label tr {
      page-break-inside: avoid;
    }
    @media print {
      .label { padding: 8px 10px; }
    }
  `;

  const printLabel = (order: OrderWithPacking) => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>Étiquette ${formatOrderNumber(order.orderNumber)}</title>
      <style>${LABEL_STYLES}</style></head><body>${buildLabelHtml(order)}</body></html>
    `);
    win.document.close();
    win.print();
  };

  const printAllLabels = () => {
    if (filteredOrders.length === 0) return;
    const allLabels = filteredOrders.map((order) => buildLabelHtml(order)).join("");
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>Étiquettes — ${filteredOrders.length} commandes</title>
      <style>${LABEL_STYLES}</style></head><body>${allLabels}</body></html>
    `);
    win.document.close();
    win.print();
  };

  const canRefundOrder = (order: OrderWithPacking) => {
    const isPaid = order.paymentStatus === "paid";
    const isSquareChannel =
      order.paymentMethod === "payment_link" ||
      Boolean(order.squarePaymentId || order.squareInvoiceId);

    return isPaid && isSquareChannel && order.status !== "cancelled";
  };

  const canRefundInStore = (order: OrderWithPacking) => {
    // Allow in-store refund as long as something was actually paid (paid or
    // partial deposit). The client may come back days later — even after the
    // order was cancelled to remove it from the production list — to collect
    // their cash refund, so we don't gate this on status !== "cancelled".
    const hasPayment =
      order.paymentStatus === "paid" ||
      order.depositPaid === true ||
      ((order as any).amountPaid || 0) > 0;
    const isInStore =
      order.paymentMethod === "in_store" &&
      !order.squarePaymentId &&
      !order.squareInvoiceId;
    const alreadyRefunded =
      Array.isArray((order as any).refunds) && (order as any).refunds.length > 0;
    return hasPayment && isInStore && !alreadyRefunded;
  };

  const submitStoreRefund = async () => {
    if (!storeRefundOrder || !storeRefundEmployee.trim()) return;
    setIsProcessingStoreRefund(true);
    try {
      const response = await fetch(
        `${normalizedApiUrl}/api/payments/refund-order-in-store`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            orderId: storeRefundOrder.id,
            employeeName: storeRefundEmployee.trim(),
            reason: storeRefundReason.trim() || undefined,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Echec du remboursement en magasin");
      }
      const refundEntry = result?.data?.refundEntry
        ? {
            ...result.data.refundEntry,
            refundedAt: String(
              result.data.refundEntry.refundedAt || new Date().toISOString(),
            ),
          }
        : {
            refundedAt: new Date().toISOString(),
            employeeName: storeRefundEmployee.trim(),
            amountCents: Math.round(storeRefundOrder.total * 100),
            reason:
              storeRefundReason.trim() ||
              `Remboursement en magasin (commande ${storeRefundOrder.orderNumber})`,
          };
      const updated = orders.map((o) => {
        if (o.id !== storeRefundOrder.id) return o;
        const nextRefunds = [...((o as any).refunds || []), refundEntry];
        return {
          ...o,
          status: "cancelled" as const,
          paymentStatus: "unpaid" as const,
          balancePaid: false,
          refunds: nextRefunds,
        };
      });
      setOrders(updated);
      setFilteredOrders(applyOrderFilters(updated));
      if (selectedOrder?.id === storeRefundOrder.id) {
        const next = updated.find((o) => o.id === storeRefundOrder.id);
        if (next) setSelectedOrder(next);
      }
      setIsStoreRefundModalOpen(false);
      setStoreRefundOrder(null);
      setStoreRefundEmployee("");
      setStoreRefundReason("");
    } catch (err: any) {
      alert(`Erreur remboursement: ${err?.message || err}`);
    } finally {
      setIsProcessingStoreRefund(false);
    }
  };

  // Translate Square's raw error text into something a staff member can act on.
  // The SDK throws errors whose message embeds the JSON body verbatim — useful
  // for logs, terrible for an alert popup. We sniff the common cases here so
  // callers can just do alert(prettifySquareError(e)).
  const prettifySquareError = (err: any): string => {
    const raw = String(err?.message || err || "");
    if (/INVALID_PHONE_NUMBER/i.test(raw)) {
      return "Numéro de téléphone non supporté par Square pour ce pays. Utilisez plutôt l'envoi par email.";
    }
    if (/INVALID_EMAIL_ADDRESS/i.test(raw)) {
      return "Adresse email invalide pour Square. Vérifie l'email du client.";
    }
    if (/UNAUTHORIZED|AUTHENTICATION_ERROR/i.test(raw)) {
      return "Session Square expirée ou clé invalide — contacter un administrateur.";
    }
    // Otherwise, hand back the message stripped of the "Status code: ... Body:"
    // wrapper so the alert is at least readable.
    const trimmed = raw.replace(/^Status code:.*?Body:\s*/is, "").trim();
    return trimmed || "Erreur inconnue";
  };

  const sendPaymentLink = async (
    order: OrderWithPacking,
    balanceOnly?: number,
    channelOverride?: "email" | "sms",
  ) => {
    const channel = channelOverride || order.paymentLinkChannel || "email";
    // If balanceOnly is provided, create a simple invoice for just the balance
    const invoicePayload: any = balanceOnly && balanceOnly > 0
      ? {
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerEmail: order.client.email,
          customerPhone: channel === "sms" ? order.client.phone : undefined,
          customerName: `${order.client.firstName} ${order.client.lastName}`.trim(),
          deliveryChannel: channel,
          items: [
            {
              name: `Solde commande ${order.orderNumber}`,
              quantity: 1,
              unitPrice: balanceOnly,
            },
          ],
          deliveryFee: 0,
          taxAmount: 0,
          total: balanceOnly,
          notes: `Solde à payer pour commande ${order.orderNumber}`,
          deliveryType: order.deliveryType,
        }
      : {
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerEmail: order.client.email,
          customerPhone: channel === "sms" ? order.client.phone : undefined,
          customerName: `${order.client.firstName} ${order.client.lastName}`.trim(),
          deliveryChannel: channel,
          items: order.items.map((item) => ({
            name: item.product?.name ?? item.productId.toString(),
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
          deliveryFee: order.deliveryFee,
          taxAmount: order.taxAmount,
          total: order.total,
          notes: `Lien de paiement pour commande ${order.orderNumber}`,
          deliveryType: order.deliveryType,
        };

    const response = await fetch(`${normalizedApiUrl}/api/payments/invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(invoicePayload),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || "Erreur creation lien de paiement");
    }

    await orderAPI.updateOrder(order.id, {
      squareInvoiceId: result.data?.invoiceId,
    });

    return result.data;
  };

  const handlePrintOrders = () => {
    if (filteredOrders.length === 0) return;

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;

    const ordersRows = filteredOrders
      .map((order) => {
        const clientName = `${order.client.firstName} ${order.client.lastName}`.trim();
        const productsSummary =
          order.items.length > 0
            ? order.items
                .map((item) => {
                  const productName = item.product?.name ?? `Produit #${item.productId}`;
                  return `${productName} (x${item.quantity})`;
                })
                .join("<br />")
            : "Aucun produit";

        return `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${getOrderDisplayNumber(order)}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${clientName}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${formatServiceTime(order)}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${productsSummary}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(order.total)}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${order.status}</td>
          </tr>
        `;
      })
      .join("");

    const grandTotal = filteredOrders.reduce((sum, order) => sum + order.total, 0);

    printWindow.document.write(`
      <html>
        <head>
          <title>Liste des commandes</title>
        </head>
        <body style="font-family: Arial, sans-serif; padding: 24px; color: #1f2937;">
          <h1 style="margin: 0 0 8px; color: #337957;">Liste des commandes</h1>
          <p style="margin: 0 0 16px;">
            Nombre de commandes: ${filteredOrders.length}<br />
            Filtre date: ${selectedDate || "Aucun"}
          </p>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
            <thead>
              <tr style="background: #f9fafb;">
                <th style="padding: 8px; text-align: left;">Numero</th>
                <th style="padding: 8px; text-align: left;">Client</th>
                <th style="padding: 8px; text-align: left;">Heure ramassage</th>
                <th style="padding: 8px; text-align: left;">Produits</th>
                <th style="padding: 8px; text-align: right;">Total</th>
                <th style="padding: 8px; text-align: left;">Statut</th>
              </tr>
            </thead>
            <tbody>${ordersRows}</tbody>
          </table>
          <div style="text-align: right;">
            <div style="font-weight: 700; font-size: 18px; margin-top: 8px;">
              Total global: ${formatCurrency(grandTotal)}
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const columns = [
    {
      key: "orderNumber",
      label: "numero de commande",
      sortable: true,
      render: (order: OrderWithPacking) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleViewProducts(order);
          }}
          className="text-left w-full hover:text-[#337957] transition-colors font-medium"
        >
          {getOrderDisplayNumber(order)}
        </button>
      ),
    },
    {
      key: "client",
      label: "Client",
      sortable: true,
      render: (order: OrderWithPacking) =>
        `${order.client.firstName} ${order.client.lastName}`,
    },
    {
      key: "serviceTime",
      label: "Date / heure",
      sortable: true,
      render: (order: OrderWithPacking) => formatServiceTime(order),
    },
    {
      key: "total",
      label: "Total",
      sortable: true,
      render: (order: OrderWithPacking) => formatCurrency(order.total),
    },
    {
      key: "paymentStatus",
      label: "Paiement",
      sortable: true,
      render: (order: OrderWithPacking) => (
        <div className="flex items-center gap-2">
          {getPaymentChannelIcon(order)}
          {getPaymentBadge(order.paymentStatus, order)}
          {isGovernmentLate(order) && (
            <span className="px-2 py-1 rounded-full text-[10px] font-black bg-red-600 text-white">
              EN RETARD (60j+)
            </span>
          )}
        </div>
      ),
    },
    {
      key: "paymentDueDate",
      label: "Date limite",
      sortable: false,
      render: (order: OrderWithPacking) => {
        // Check if there's a refund due
        const storedPaid = (order as any).amountPaid || 0;
        const paidAmount = storedPaid > 0
          ? storedPaid
          : order.paymentStatus === "paid"
            ? Math.max(order.total, order.depositAmount)
            : order.depositPaid
              ? order.depositAmount
              : 0;
        const refundDue = paidAmount - order.total;

        if (refundDue > 0.01) {
          return (
            <div
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-black cursor-pointer"
              onClick={() => {
                setBalanceRefundOrder(order);
                setBalanceRefundEmployee("");
                setIsBalanceRefundModalOpen(true);
              }}
              title="Cliquez pour rembourser"
            >
              REMBOURSER {formatCurrency(refundDue)}
            </div>
          );
        }

        const due = getPaymentDueDateForOrder(order);
        if (!due) return <span className="text-xs text-gray-400">-</span>;
        const isOverdue = order.paymentStatus !== "paid" && new Date() > due;
        return (
          <span className={isOverdue ? "text-xs font-bold text-red-700" : "text-xs text-gray-700"}>
            {formatDateOnly(due.toISOString())}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Statut",
      sortable: true,
      render: (order: OrderWithPacking) => getStatusBadge(order.status),
    },
    {
      key: "actions",
      label: "Actions",
      render: (order: OrderWithPacking) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <button className="p-2 hover:bg-gray-100 rounded">
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleViewDetails(order)}>
              <Eye className="h-4 w-4 mr-2" />
              Voir details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleEdit(order)}>
              <Edit className="h-4 w-4 mr-2" />
              Modifier
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => printLabel(order)}>
              <Tag className="h-4 w-4 mr-2" />
              Imprimer étiquette
            </DropdownMenuItem>
            {order.status !== "cancelled" && order.status !== "completed" && (
              <>
                {order.status === "pending" && (
                  <DropdownMenuItem
                    onClick={() => handleUpdateStatus(order.id, "confirmed")}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Confirmer
                  </DropdownMenuItem>
                )}
                {order.status === "confirmed" && (
                  <>
                    <DropdownMenuItem
                      onClick={() =>
                        handleUpdateStatus(order.id, "in_production")
                      }
                    >
                      <Package className="h-4 w-4 mr-2" />
                      Mettre en production
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleUpdateStatus(order.id, "pending")}
                    >
                      <Undo2 className="h-4 w-4 mr-2" />
                      Revenir à en attente
                    </DropdownMenuItem>
                  </>
                )}
                {order.status === "in_production" && (
                  <>
                    <DropdownMenuItem
                      onClick={() => handleUpdateStatus(order.id, "ready")}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Marquer prete
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleUpdateStatus(order.id, "confirmed")}
                    >
                      <Undo2 className="h-4 w-4 mr-2" />
                      Revenir à confirmée
                    </DropdownMenuItem>
                  </>
                )}
                {order.status === "ready" && (
                  <>
                    <DropdownMenuItem
                      onClick={() => handleUpdateStatus(order.id, "completed")}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Marquer ramassee
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleUpdateStatus(order.id, "in_production")}
                    >
                      <Undo2 className="h-4 w-4 mr-2" />
                      Revenir à en production
                    </DropdownMenuItem>
                  </>
                )}
                {canRefundOrder(order) && (
                  <DropdownMenuItem onClick={() => handleRefundClick(order)}>
                    <XCircle className="h-4 w-4 mr-2" />
                    Rembourser via Square
                  </DropdownMenuItem>
                )}
                {canRefundInStore(order) && (
                  <DropdownMenuItem
                    onClick={() => {
                      setStoreRefundOrder(order);
                      setStoreRefundEmployee("");
                      setStoreRefundReason("");
                      setIsStoreRefundModalOpen(true);
                    }}
                  >
                    <Store className="h-4 w-4 mr-2" />
                    Rembourser via magasin
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-red-600"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Annuler la commande ${formatOrderNumber(order.orderNumber)} ?\n\nLes produits seront retirés de la liste de production. Le remboursement (en magasin) pourra être enregistré plus tard.`,
                      )
                    ) {
                      handleUpdateStatus(order.id, "cancelled");
                    }
                  }}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Annuler la commande
                </DropdownMenuItem>
              </>
            )}
            {/* Allow in-store refund of an already-cancelled order so the
                client can come back later for their cash refund. */}
            {order.status === "cancelled" && canRefundInStore(order) && (
              <DropdownMenuItem
                onClick={() => {
                  setStoreRefundOrder(order);
                  setStoreRefundEmployee("");
                  setStoreRefundReason("");
                  setIsStoreRefundModalOpen(true);
                }}
              >
                <Store className="h-4 w-4 mr-2" />
                Rembourser via magasin
              </DropdownMenuItem>
            )}
            {order.status === "cancelled" && (
              <DropdownMenuItem onClick={() => handleReconcileRefund(order)}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Synchroniser le remboursement
              </DropdownMenuItem>
            )}
            {order.status === "completed" && (
              <DropdownMenuItem
                onClick={() => handleUpdateStatus(order.id, "ready")}
              >
                <Undo2 className="h-4 w-4 mr-2" />
                Revenir à prête
              </DropdownMenuItem>
            )}
            {order.paymentStatus !== "paid" && (
              <DropdownMenuItem onClick={() => handleMarkPaid(order)}>
                <DollarSign className="h-4 w-4 mr-2" />
                Marquer payé
              </DropdownMenuItem>
            )}
            {(() => {
              const storedPaid = (order as any).amountPaid;
              const paidAmount = storedPaid > 0
                ? storedPaid
                : order.paymentStatus === "paid"
                  ? (order.depositAmount > order.total ? order.depositAmount : 0)
                  : order.depositPaid
                    ? order.depositAmount
                    : 0;
              const refundAmount = paidAmount - order.total;
              if (refundAmount > 0.01) {
                return (
                  <DropdownMenuItem
                    className="text-green-700 font-medium"
                    onClick={() => {
                      setBalanceRefundOrder(order);
                      setBalanceRefundEmployee("");
                      setIsBalanceRefundModalOpen(true);
                    }}
                  >
                    <Undo2 className="h-4 w-4 mr-2" />
                    Rembourser {formatCurrency(refundAmount)}
                  </DropdownMenuItem>
                );
              }
              return null;
            })()}
            <DropdownMenuItem
              onClick={() => handleDeleteClick(order)}
              className="text-red-600"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const completeColumns = [
    ...columns.slice(0, 3),
    {
      key: "productsPreview",
      label: "Produits",
      sortable: false,
      render: (order: OrderWithPacking) => (
        <div className="space-y-2 min-w-70">
          {order.items.map((item) => {
            const { chips, parsed } = getItemOptionChips(item);
            return (
              <div key={`${order.id}-${item.id}`} className="rounded-md border border-gray-200 bg-gray-50 p-2">
                <div className="text-xs font-semibold text-gray-900">
                  {item.productId === 0
                    ? <span className="text-purple-700">[Personnalisé] {item.product?.name || "Item personnalisé"}</span>
                    : (item.product?.name || `Produit #${item.productId}`)
                  }{" "}x{item.quantity}
                </div>
                {chips.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {chips.map((option) => (
                      <span key={option} className="inline-flex rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-[10px]">
                        {option}
                      </span>
                    ))}
                  </div>
                )}
                {parsed.allergies && (
                  <div className="mt-1 rounded bg-amber-100 text-amber-900 px-2 py-1 text-[10px] font-medium">
                    Allergies: {parsed.allergies}
                                  {parsed.description && (
                                    <div className="mt-1 text-[11px] text-purple-800 italic">
                                      {parsed.description}
                                    </div>
                                  )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ),
    },
    ...columns.slice(3),
  ];

  const getSearchValue = (order: OrderWithPacking) => {
    return `${order.orderNumber} ${formatOrderNumber(order.orderNumber)} ${getOrderDisplayNumber(order)} ${order.client.firstName} ${order.client.lastName} ${order.client.phone}`;
  };

  return (
    <>
      {/* NOTIFICATION AFTER ORDER EDIT */}
      {editNotification && (
        <div className="fixed top-4 right-4 z-50 max-w-md animate-fade-in">
          {editNotification.type === "balance" && (
            <div className="bg-orange-600 text-white px-5 py-4 rounded-xl shadow-xl">
              <p className="font-bold text-sm">Balance à payer: {formatCurrency(editNotification.amount)}</p>
              <p className="text-xs opacity-90 mt-1">
                {editNotification.clientName} va recevoir un email avec le montant restant à payer.
              </p>
            </div>
          )}
          {editNotification.type === "refund" && (
            <div className="bg-green-600 text-white px-5 py-4 rounded-xl shadow-xl">
              <p className="font-bold text-sm">Remboursement: {formatCurrency(editNotification.amount)}</p>
              <p className="text-xs opacity-90 mt-1">
                {editNotification.clientName} va recevoir un email. Un crédit de {formatCurrency(editNotification.amount)} lui est dû.
              </p>
            </div>
          )}
          {editNotification.type === "nochange" && (
            <div className="bg-blue-600 text-white px-5 py-4 rounded-xl shadow-xl">
              <p className="font-bold text-sm">Commande modifiée</p>
              <p className="text-xs opacity-90 mt-1">Aucun changement de montant.</p>
            </div>
          )}
        </div>
      )}

      {/* BALANCE PAYMENT METHOD MODAL */}
      <Modal
        open={balancePaymentModal.open}
        onOpenChange={(open) => {
          if (!open) setBalancePaymentModal({ open: false, order: null, amount: 0, clientName: "" });
        }}
        type="form"
        title="Solde restant à payer"
        description={`${balancePaymentModal.clientName} doit payer un solde de ${formatCurrency(balancePaymentModal.amount)}`}
        closable={!isSendingBalanceLink}
        actions={{
          secondary: {
            label: "Fermer",
            onClick: () => setBalancePaymentModal({ open: false, order: null, amount: 0, clientName: "" }),
            disabled: isSendingBalanceLink,
          },
        }}
      >
        <div className="space-y-4">
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-orange-700">{formatCurrency(balancePaymentModal.amount)}</p>
            <p className="text-sm text-orange-600 mt-1">Montant restant</p>
          </div>

          <p className="text-sm text-stone-600 text-center">Comment le client souhaite-t-il payer le solde ?</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              disabled={isSendingBalanceLink}
              onClick={() => {
                setBalancePaymentModal({ open: false, order: null, amount: 0, clientName: "" });
                setEditNotification({
                  type: "balance",
                  amount: balancePaymentModal.amount,
                  clientName: balancePaymentModal.clientName,
                });
                setTimeout(() => setEditNotification(null), 5000);
              }}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-stone-200 hover:border-[#C5A065] hover:bg-[#C5A065]/5 transition-all text-center"
            >
              <Store className="w-7 h-7 text-[#C5A065]" />
              <span className="font-bold text-sm text-stone-800">En boutique</span>
              <span className="text-xs text-stone-500">Le client paiera sur place</span>
            </button>

            <button
              disabled={isSendingBalanceLink}
              onClick={async () => {
                const order = balancePaymentModal.order;
                if (!order) return;
                setIsSendingBalanceLink(true);
                try {
                  await sendPaymentLink(order, balancePaymentModal.amount, "email");
                  setBalancePaymentModal({ open: false, order: null, amount: 0, clientName: "" });
                  setEditNotification({
                    type: "balance",
                    amount: balancePaymentModal.amount,
                    clientName: balancePaymentModal.clientName,
                  });
                  setTimeout(() => setEditNotification(null), 5000);
                  alert(`Lien de paiement envoyé par email à ${order.client.email}`);
                } catch (e: any) {
                  alert(`Erreur: ${e?.message || "Impossible d'envoyer l'email"}`);
                } finally {
                  setIsSendingBalanceLink(false);
                }
              }}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-stone-200 hover:border-[#337957] hover:bg-[#337957]/5 transition-all text-center"
            >
              {isSendingBalanceLink ? (
                <div className="w-6 h-6 border-2 border-[#337957] border-t-transparent rounded-full animate-spin" />
              ) : (
                <Mail className="w-7 h-7 text-[#337957]" />
              )}
              <span className="font-bold text-sm text-stone-800">Par email</span>
              <span className="text-xs text-stone-500 truncate max-w-full">
                {balancePaymentModal.order?.client.email || "—"}
              </span>
            </button>

            <button
              disabled={
                isSendingBalanceLink || !balancePaymentModal.order?.client.phone
              }
              onClick={async () => {
                const order = balancePaymentModal.order;
                if (!order) return;
                if (!order.client.phone) {
                  alert("Ce client n'a pas de numéro de téléphone enregistré.");
                  return;
                }
                setIsSendingBalanceLink(true);
                try {
                  await sendPaymentLink(order, balancePaymentModal.amount, "sms");
                  setBalancePaymentModal({ open: false, order: null, amount: 0, clientName: "" });
                  setEditNotification({
                    type: "balance",
                    amount: balancePaymentModal.amount,
                    clientName: balancePaymentModal.clientName,
                  });
                  setTimeout(() => setEditNotification(null), 5000);
                  alert(`Lien de paiement envoyé par SMS à ${order.client.phone}`);
                } catch (e: any) {
                  alert(prettifySquareError(e));
                } finally {
                  setIsSendingBalanceLink(false);
                }
              }}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-stone-200 hover:border-[#2563eb] hover:bg-[#2563eb]/5 transition-all text-center disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSendingBalanceLink ? (
                <div className="w-6 h-6 border-2 border-[#2563eb] border-t-transparent rounded-full animate-spin" />
              ) : (
                <Phone className="w-7 h-7 text-[#2563eb]" />
              )}
              <span className="font-bold text-sm text-stone-800">Par SMS</span>
              <span className="text-xs text-stone-500 truncate max-w-full">
                {balancePaymentModal.order?.client.phone || "Aucun téléphone"}
              </span>
            </button>
          </div>
        </div>
      </Modal>

      {/* ALERT FOR OVERDUE PAYMENTS - AT TOP CENTER */}
      {(() => {
        const overdueOrders = orders.filter((order) => {
          const dueDate = getPaymentDueDateForOrder(order);
          return dueDate && new Date() > dueDate && order.paymentStatus !== "paid";
        });
        
        if (overdueOrders.length === 0) return null;
        
        return (
          <div className="p-4 md:p-4">
            <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 md:p-6 max-w-4xl mx-auto">
              <div className="flex items-start gap-4">
                <AlertTriangle className="w-8 h-8 text-red-500 shrink-0" />
                <div className="flex-1">
                  <h3 className="font-bold text-red-900 text-lg mb-2">
                    {overdueOrders.length} Paiement{overdueOrders.length > 1 ? 's' : ''} en Retard
                  </h3>
                  <p className="text-red-800 text-sm mb-3">
                    Les paiements suivants ont dépassé leur date limite:
                  </p>
                  <div className="space-y-2">
                    {overdueOrders.slice(0, 5).map((order) => {
                      return (
                        <div key={order.id} className="text-sm text-red-900 flex justify-between items-center p-2 bg-white rounded">
                          <span className="font-medium">{getOrderDisplayNumber(order)}</span>
                          <span className="text-xs bg-red-200 px-2 py-1 rounded font-bold">
                            En retard
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {overdueOrders.length > 5 && (
                    <p className="text-red-800 text-sm mt-2 font-semibold">
                      +{overdueOrders.length - 5} autre{overdueOrders.length - 5 > 1 ? 's' : ''} paiement(s) en retard
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <header className="p-4 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2
              className="text-4xl md:text-5xl mb-2"
              style={{ fontFamily: '"Great Vibes", cursive', color: "#337957" }}
            >
              Gestion des Commandes
            </h2>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
              Gerer toutes les commandes (en ligne, telephone, en magasin)
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleProcessReminders}
              disabled={isProcessingReminders}
              className="flex items-center gap-2 bg-[#F59E0B] hover:bg-[#D97706] text-white font-bold px-4 md:px-6 py-2.5 md:py-3 rounded-xl transition-all duration-300 hover:shadow-lg text-sm md:text-base whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessingReminders ? (
                <RefreshCw size={20} className="animate-spin" />
              ) : (
                <Bell size={20} />
              )}
              <span>{isProcessingReminders ? "Traitement..." : "Rappels"}</span>
            </button>
            <button
              onClick={printAllLabels}
              disabled={filteredOrders.length === 0}
              className="flex items-center gap-2 bg-white border border-stone-200 text-stone-600 hover:bg-stone-50 font-bold px-4 md:px-6 py-2.5 md:py-3 rounded-xl transition-all duration-300 text-sm md:text-base whitespace-nowrap disabled:opacity-50"
            >
              <Printer size={20} />
              <span className="hidden md:inline">Étiquettes ({filteredOrders.length})</span>
            </button>
            <button
              onClick={exportOrdersToExcel}
              className="flex items-center gap-2 bg-white border border-stone-200 text-stone-600 hover:bg-stone-50 font-bold px-4 md:px-6 py-2.5 md:py-3 rounded-xl transition-all duration-300 text-sm md:text-base whitespace-nowrap"
            >
              <Download size={20} />
              <span className="hidden md:inline">Exporter</span>
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 bg-[#337957] hover:bg-[#2D2A26] text-white font-bold px-4 md:px-6 py-2.5 md:py-3 rounded-xl transition-all duration-300 hover:shadow-lg text-sm md:text-base whitespace-nowrap"
            >
              <Plus size={20} />
              <span>Nouvelle Commande</span>
            </button>
          </div>
        </div>
      </header>

      {/* REMINDER PROCESSING RESULT */}
      {reminderResult && (
        <div className="p-4 md:p-8 pt-0">
          <div className={`border-2 rounded-xl p-4 md:p-6 ${reminderResult.success ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
            <div className="flex items-start gap-4">
              <div className="text-2xl">{reminderResult.success ? '✅' : '❌'}</div>
              <div className="flex-1">
                <h3 className={`font-bold text-lg mb-2 ${reminderResult.success ? 'text-green-900' : 'text-red-900'}`}>
                  {reminderResult.success ? 'Rappels traités avec succès' : 'Erreur lors du traitement'}
                </h3>
                <p className={`text-sm mb-3 ${reminderResult.success ? 'text-green-800' : 'text-red-800'}`}>
                  {reminderResult.message}
                </p>
                {reminderResult.summary && (
                  <div className="text-sm text-green-800 bg-white p-3 rounded">
                    <p><strong>Total commandes:</strong> {reminderResult.summary.totalOrders}</p>
                    <p><strong>Rappels (1 semaine):</strong> {reminderResult.summary.remindersSentWeek}</p>
                    <p><strong>Rappels (48h):</strong> {reminderResult.summary.remindersSent48h}</p>
                    <p><strong>Rappels (en retard):</strong> {reminderResult.summary.remindersSentOverdue}</p>
                    <p><strong>Commandes annulées:</strong> {reminderResult.summary.ordersCancelled}</p>
                    {reminderResult.summary.errors > 0 && (
                      <p className="text-red-600"><strong>Erreurs:</strong> {reminderResult.summary.errors}</p>
                    )}
                  </div>
                )}
              </div>
              <button 
                onClick={() => setReminderResult(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 md:p-8">
        {/* Filtre par date */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-4">
          <div className="sm:w-56">
            <Label htmlFor="order-date-filter" className="text-xs text-gray-600">
              Date de ramassage
            </Label>
            <Input
              id="order-date-filter"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          {selectedDate && (
            <Button
              onClick={() => setSelectedDate("")}
              variant="ghost"
              size="sm"
              className="text-[#337957] hover:text-[#B38F55]"
            >
              Effacer
            </Button>
          )}

          <div className="flex items-center gap-2 sm:ml-2">
            <Checkbox
              id="orders-show-archived"
              checked={showArchived}
              onCheckedChange={(value) => setShowArchived(value === true)}
            />
            <Label htmlFor="orders-show-archived" className="text-xs text-gray-600 cursor-pointer">
              Afficher ramassées/terminées ({orders.filter((o) => isArchivedStatus(o.status)).length})
            </Label>
          </div>
          <Button
            onClick={handlePrintOrders}
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={filteredOrders.length === 0}
          >
            <Printer className="h-4 w-4" />
            Imprimer toutes les commandes
          </Button>

          <Button
            onClick={() => setViewMode((prev) => (prev === "simple" ? "complete" : "simple"))}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            {viewMode === "simple" ? "Vue complete" : "Vue simplifiee"}
          </Button>
        </div>

        <DataTable
          data={filteredOrders}
          columns={viewMode === "simple" ? columns : completeColumns}
          filters={[]}
          searchPlaceholder="Rechercher par numero, client ou telephone..."
          getSearchValue={getSearchValue}
          itemsPerPage={10}
          selectable={false}
          rowClassName={(order: OrderWithPacking) => getOrderColor(order)}
        />
      </div>

      {/* MODAL DES PRODUITS AVEC BOUTONS EMBALLER */}
      <Modal
        open={isProductsModalOpen}
        onOpenChange={setIsProductsModalOpen}
        type="details"
        title={`Produits de la commande ${selectedOrderForProducts ? formatOrderNumber(selectedOrderForProducts.orderNumber) : ""}`}
        description={`Client: ${selectedOrderForProducts?.client.firstName} ${selectedOrderForProducts?.client.lastName}`}
        icon={<Package className="h-6 w-6 text-[#337957]" />}
        size="lg"
        actions={{
          secondary: {
            label: "Fermer",
            onClick: () => {
              setIsProductsModalOpen(false);
              setSelectedOrderForProducts(null);
            },
          },
        }}
      >
        {selectedOrderForProducts && (
          <div className="space-y-4">
            {/* Indicateur de commande prete */}
            {selectedOrderForProducts.items.length > 0 &&
              selectedOrderForProducts.items.every((item) => item.productionStatus === "ready") && (
              <div className="p-3 bg-green-100 border border-green-300 rounded-lg text-center">
                <span className="text-green-800 font-semibold text-sm flex items-center justify-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  COMMANDE PRETE - Tous les produits sont emballes
                </span>
              </div>
            )}

            {selectedOrderForProducts.items.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                Aucun produit dans cette commande
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Produit</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Quantite</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Prix unitaire</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Sous-total</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Emballage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {selectedOrderForProducts.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3 text-sm">
                          {item.product?.name ?? `Produit #${item.productId}`}
                        </td>
                        <td className="px-4 py-3 text-sm">{item.quantity}</td>
                        <td className="px-4 py-3 text-sm">{formatCurrency(item.unitPrice)}</td>
                        <td className="px-4 py-3 text-sm">{formatCurrency(item.subtotal)}</td>
                        <td className="px-4 py-3 text-sm">
                          {item.productionStatus !== "ready" ? (
                            <Button
                              onClick={() => handlePackItem(selectedOrderForProducts.id, item.id)}
                              size="sm"
                              className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
                            >
                              Emballer
                            </Button>
                          ) : (
                            <Button
                              onClick={() => handleUnpackItem(selectedOrderForProducts.id, item.id)}
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs border-green-600 text-green-800 hover:bg-green-50"
                            >
                              <Check className="w-3 h-3 mr-1" />
                              Emballé
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            
            <div className="flex justify-end pt-4 border-t">
              <div className="w-64 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Sous-total:</span>
                  <span className="font-medium">{formatCurrency(selectedOrderForProducts.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Taxes:</span>
                  <span className="font-medium">{formatCurrency(selectedOrderForProducts.taxAmount)}</span>
                </div>
                {selectedOrderForProducts.deliveryFee > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Livraison:</span>
                    <span className="font-medium">{formatCurrency(selectedOrderForProducts.deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold border-t pt-2">
                  <span>Total:</span>
                  <span>{formatCurrency(selectedOrderForProducts.total)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      
      <Modal
        open={isDetailsModalOpen}
        onOpenChange={setIsDetailsModalOpen}
        type="details"
        title="Details de la Commande"
        description="Informations completes sur la commande"
        icon={<Eye className="h-6 w-6 text-(--bakery-gold)" />}
        size="xl"
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
          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Articles</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {selectedOrder.items.length}
                    </p>
                  </div>
                  <Package className="w-8 h-8 text-[#337957]" />
                </div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Total</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {formatCurrency(selectedOrder.total)}
                    </p>
                  </div>
                  <DollarSign className="w-8 h-8 text-[#337957]" />
                </div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Statut</p>
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {getStatusBadge(selectedOrder.status)}
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-[#337957]" />
                </div>
              </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="details" className="w-full">
              <TabsList className="w-full grid grid-cols-5">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="items">
                  Articles ({selectedOrder.items.length})
                </TabsTrigger>
                <TabsTrigger value="payments">Paiements</TabsTrigger>
                <TabsTrigger value="delivery">Livraison</TabsTrigger>
                <TabsTrigger value="history">Historique</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-4">
                <div className="p-6 bg-linear-to-br from-(--bakery-cream) to-white rounded-xl border border-(--bakery-border)">
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-full bg-(--bakery-gold) bg-opacity-20 flex items-center justify-center">
                        <Package className="w-10 h-10 text-(--bakery-gold)" />
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-(--bakery-text)">
                          {formatOrderNumber(selectedOrder.orderNumber)}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          {getPaymentBadge(selectedOrder.paymentStatus, selectedOrder)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-sm text-(--bakery-text-secondary)">
                      <p>Commandee le</p>
                      <p className="font-medium text-(--bakery-text)">
                        {formatDate(selectedOrder.orderDate)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                    <div>
                      <h4 className="font-semibold text-(--bakery-text) mb-3">
                        Informations client
                      </h4>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 p-3 bg-white rounded-lg">
                          <UserCircle className="w-5 h-5 text-(--bakery-gold)" />
                          <div>
                            <p className="text-xs text-(--bakery-text-secondary)">
                              Nom
                            </p>
                            <p className="text-sm font-medium text-(--bakery-text)">
                              {selectedOrder.client.firstName}{" "}
                              {selectedOrder.client.lastName}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-white rounded-lg">
                          <Mail className="w-5 h-5 text-(--bakery-gold)" />
                          <div>
                            <p className="text-xs text-(--bakery-text-secondary)">
                              Email
                            </p>
                            <p className="text-sm font-medium text-(--bakery-text)">
                              {selectedOrder.client.email}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-white rounded-lg">
                          <Phone className="w-5 h-5 text-(--bakery-gold)" />
                          <div>
                            <p className="text-xs text-(--bakery-text-secondary)">
                              Telephone
                            </p>
                            <p className="text-sm font-medium text-(--bakery-text)">
                              {selectedOrder.client.phone}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-semibold text-(--bakery-text) mb-3">
                        Informations de commande
                      </h4>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 p-3 bg-white rounded-lg">
                          <Calendar className="w-5 h-5 text-(--bakery-gold)" />
                          <div>
                            <p className="text-xs text-(--bakery-text-secondary)">
                              Date de ramassage
                            </p>
                            <p className="text-sm font-medium text-(--bakery-text)">
                              {formatDateOnly(selectedOrder.pickupDate)}
                            </p>
                          </div>
                        </div>
                        {selectedOrder.deliveryType === "pickup" && (
                          <div className="flex items-center gap-3 p-3 bg-white rounded-lg">
                            <Clock className="w-5 h-5 text-(--bakery-gold)" />
                            <div>
                              <p className="text-xs text-(--bakery-text-secondary)">
                                Heure de ramassage
                              </p>
                              <p className="text-sm font-medium text-(--bakery-text)">
                                {selectedOrder.deliveryTimeSlot ||
                                  new Date(selectedOrder.pickupDate).toLocaleTimeString("fr-CA", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    hour12: false,
                                  })}
                              </p>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-3 p-3 bg-white rounded-lg">
                          <MapPin className="w-5 h-5 text-(--bakery-gold)" />
                          <div>
                            <p className="text-xs text-(--bakery-text-secondary)">
                              Lieu
                            </p>
                            <p className="text-sm font-medium text-(--bakery-text)">
                              {selectedOrder.pickupLocation}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-white rounded-lg">
                          <Truck className="w-5 h-5 text-(--bakery-gold)" />
                          <div>
                            <p className="text-xs text-(--bakery-text-secondary)">
                              Type
                            </p>
                            <p className="text-sm font-medium text-(--bakery-text)">
                              {selectedOrder.deliveryType === "pickup"
                                ? "Ramassage"
                                : "Livraison"}
                            </p>
                          </div>
                        </div>
                        {selectedOrder.deliveryType === "delivery" && selectedOrder.deliveryDate && (
                          <div className="flex items-center gap-3 p-3 bg-white rounded-lg">
                            <Calendar className="w-5 h-5 text-(--bakery-gold)" />
                            <div>
                              <p className="text-xs text-(--bakery-text-secondary)">
                                Date de livraison
                              </p>
                              <p className="text-sm font-medium text-(--bakery-text)">
                                {formatDateOnly(selectedOrder.deliveryDate)}
                              </p>
                            </div>
                          </div>
                        )}
                        {selectedOrder.deliveryType === "delivery" && selectedOrder.deliveryTimeSlot && (
                          <div className="flex items-center gap-3 p-3 bg-white rounded-lg">
                            <Clock className="w-5 h-5 text-(--bakery-gold)" />
                            <div>
                              <p className="text-xs text-(--bakery-text-secondary)">
                                Creneau horaire
                              </p>
                              <p className="text-sm font-medium text-(--bakery-text)">
                                {selectedOrder.deliveryTimeSlot}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {selectedOrder.notes && (
                    <div className="p-4 bg-white rounded-lg">
                      <h4 className="font-semibold text-(--bakery-text) mb-2">
                        Notes
                      </h4>
                      <p className="text-sm text-(--bakery-text-secondary)">
                        {selectedOrder.notes}
                      </p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="items" className="space-y-4">
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                          Produit
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                          Quantite
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                          Prix unitaire
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                          Sous-total
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                          Statut
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {selectedOrder.items.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-8 text-center text-gray-500"
                          >
                            Aucun article dans cette commande
                          </td>
                        </tr>
                      ) : (
                        selectedOrder.items.map((item) => {
                          const { chips } = getItemOptionChips(item);
                          return (
                          <tr key={item.id}>
                            <td className="px-4 py-3 text-sm">
                              <div>{item.product?.name ?? `Produit #${item.productId}`}</div>
                              {chips.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {chips.map((option) => (
                                    <span
                                      key={option}
                                      className="inline-flex rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-[10px]"
                                    >
                                      {option}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {item.quantity}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {formatCurrency(item.unitPrice)}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {formatCurrency(item.subtotal)}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <span
                                className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  item.productionStatus === "ready"
                                    ? "bg-green-100 text-green-800"
                                    : item.productionStatus === "in_progress"
                                      ? "bg-blue-100 text-blue-800"
                                      : "bg-gray-100 text-gray-800"
                                }`}
                              >
                                {item.productionStatus === "ready"
                                  ? "Pret"
                                  : item.productionStatus === "in_progress"
                                    ? "En cours"
                                    : "En attente"}
                              </span>
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <div className="w-64 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Sous-total:</span>
                      <span className="font-medium">
                        {formatCurrency(selectedOrder.subtotal)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Taxes:</span>
                      <span className="font-medium">
                        {formatCurrency(selectedOrder.taxAmount)}
                      </span>
                    </div>
                    {selectedOrder.deliveryFee > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Livraison:</span>
                        <span className="font-medium">
                          {formatCurrency(selectedOrder.deliveryFee)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-bold border-t pt-2">
                      <span>Total:</span>
                      <span>{formatCurrency(selectedOrder.total)}</span>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="payments" className="space-y-4">
                <div className="space-y-3">
                  {selectedOrder.refunds && selectedOrder.refunds.length > 0 && (() => {
                    const last = selectedOrder.refunds[selectedOrder.refunds.length - 1];
                    const amount = (last.amountCents || 0) / 100;
                    // No paymentId means it was a manual in-store refund (cash/debit
                    // returned at the counter), not a Square reversal.
                    const isInStore = !last.paymentId;
                    const title = isInStore
                      ? "Remboursement via magasin"
                      : "Remboursement Square";
                    const wrapperClass = isInStore
                      ? "border rounded-lg p-4 bg-amber-50 border-amber-200"
                      : "border rounded-lg p-4 bg-red-50 border-red-200";
                    const badgeClass = isInStore
                      ? "px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-sm font-medium"
                      : "px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium";
                    return (
                      <div className={wrapperClass}>
                        <div className="flex justify-between items-start gap-4">
                          <div>
                            <div className="font-semibold text-gray-900">{title}</div>
                            <div className="text-sm text-gray-700 mt-1">
                              Effectué par <span className="font-bold">{last.employeeName}</span>
                            </div>
                            <div className="text-xs text-gray-600 mt-1 space-y-0.5">
                              <div>Date: {formatDate(last.refundedAt)}</div>
                              <div>Montant: {formatCurrency(amount)}</div>
                              {last.reason && <div>Raison: {last.reason}</div>}
                              {!isInStore && last.refundId && (
                                <div>Refund ID: {last.refundId}</div>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className={badgeClass}>
                              {isInStore ? "Remboursé via magasin" : "Remboursé"}
                            </span>
                            {!isInStore && last.refundStatus && (
                              <div className="text-xs text-gray-500 mt-1">
                                Statut: {last.refundStatus}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {/* Méthode de paiement */}
                  <div className="border rounded-lg p-4 bg-amber-50 border-amber-200">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-semibold text-gray-900">
                          Méthode de paiement
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                          {selectedOrder.paymentMethod === "payment_link"
                            ? "Lien de paiement envoyé"
                            : "Paiement en magasin"}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-sm font-medium">
                          {selectedOrder.paymentMethod === "payment_link"
                            ? "Lien de paiement"
                            : "En magasin"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="border rounded-lg p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-semibold text-gray-900">
                          Paiement total (100%)
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                          {formatCurrency(selectedOrder.depositAmount)}
                        </div>
                      </div>
                      <div className="text-right">
                        {selectedOrder.depositPaid ? (
                          <>
                            <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                              Paye
                            </span>
                            {selectedOrder.depositPaidAt && (
                              <div className="text-xs text-gray-500 mt-1">
                                {formatDate(selectedOrder.depositPaidAt)}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium">
                            Non paye
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border rounded-lg p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-semibold text-gray-900">
                          Solde restant
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                          {formatCurrency(
                            selectedOrder.total - selectedOrder.depositAmount,
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        {selectedOrder.balancePaid ? (
                          <>
                            <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                              Paye
                            </span>
                            {selectedOrder.balancePaidAt && (
                              <div className="text-xs text-gray-500 mt-1">
                                {formatDate(selectedOrder.balancePaidAt)}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
                            {selectedOrder.paymentMethod === "in_store"
                              ? "Aucun solde"
                              : "Du au retrait"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Balance after modification */}
                  {(() => {
                    const paidAmount = (selectedOrder as any).amountPaid || 0;
                    const balance = selectedOrder.total - paidAmount;
                    if (Math.abs(balance) < 0.01 || paidAmount < 0.01) return null;
                    const isRefund = balance < 0;
                    return (
                      <div className={`border-2 rounded-lg p-4 ${isRefund ? 'bg-green-50 border-green-300' : 'bg-orange-50 border-orange-300'}`}>
                        <div className="flex justify-between items-center">
                          <div>
                            <div className={`font-bold ${isRefund ? 'text-green-800' : 'text-orange-800'}`}>
                              {isRefund ? 'Crédit client' : 'Balance à payer'}
                            </div>
                            <div className={`text-xs mt-1 ${isRefund ? 'text-green-600' : 'text-orange-600'}`}>
                              Total: {formatCurrency(selectedOrder.total)} — Payé: {formatCurrency(paidAmount)}
                            </div>
                          </div>
                          <div className={`text-2xl font-black ${isRefund ? 'text-green-700' : 'text-orange-700'}`}>
                            {formatCurrency(Math.abs(balance))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Refund history */}
                  {(selectedOrder as any).refunds?.length > 0 && (
                    <div className="border-2 border-red-200 bg-red-50 rounded-lg p-4">
                      <div className="font-bold text-red-800 mb-3">Historique des remboursements</div>
                      <div className="space-y-2">
                        {(selectedOrder as any).refunds.map((refund: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center bg-white rounded-lg p-3 border border-red-100">
                            <div>
                              <div className="text-sm font-semibold text-gray-900">
                                {refund.amountCents ? formatCurrency(refund.amountCents / 100) : "—"}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {refund.refundedAt ? formatDate(refund.refundedAt) : "—"}
                              </div>
                              {refund.reason && (
                                <div className="text-xs text-gray-400 mt-0.5">{refund.reason}</div>
                              )}
                            </div>
                            <div className="text-right">
                              {refund.employeeName && (
                                <div className="text-sm font-bold text-red-700">
                                  Par: {refund.employeeName}
                                </div>
                              )}
                              <div className="text-xs text-gray-400">
                                {refund.refundStatus || "effectué"}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="delivery" className="space-y-4">
                {selectedOrder.deliveryType === "delivery" ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">
                        Adresse de livraison
                      </h3>
                      {selectedOrder.deliveryAddress && (
                        <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded">
                          <div>{selectedOrder.deliveryAddress.street}</div>
                          <div>
                            {selectedOrder.deliveryAddress.city},{" "}
                            {selectedOrder.deliveryAddress.province}{" "}
                            {selectedOrder.deliveryAddress.postalCode}
                          </div>
                        </div>
                      )}
                    </div>

                    {selectedOrder.deliverySlot && (
                      <div>
                        <h3 className="font-semibold text-gray-900 mb-2">
                          Creneau horaire
                        </h3>
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <Clock className="h-4 w-4" />
                          {selectedOrder.deliverySlot}
                        </div>
                      </div>
                    )}

                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">
                        Frais de livraison
                      </h3>
                      <div className="text-2xl font-bold text-gray-900">
                        {formatCurrency(selectedOrder.deliveryFee)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">
                        Lieu de ramassage
                      </h3>
                      <div className="text-lg font-medium text-gray-900">
                        {selectedOrder.pickupLocation}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">
                        Date et heure de ramassage
                      </h3>
                      <div className="flex items-center gap-2 text-gray-700">
                        <Calendar className="h-5 w-5" />
                        {formatDate(selectedOrder.pickupDate)}
                      </div>
                    </div>

                    {selectedOrder.pickupLocation === "Montreal" &&
                      selectedOrder.interLocationDeliveryDate && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                          <div className="flex items-start gap-3">
                            <Truck className="h-5 w-5 text-blue-600 mt-0.5" />
                            <div>
                              <h3 className="font-semibold text-blue-900 mb-1">
                                Livraison inter-succursale
                              </h3>
                              <p className="text-sm text-blue-700">
                                Cette commande sera livree de Laval a Montreal
                                le{" "}
                                {formatDate(
                                  selectedOrder.interLocationDeliveryDate,
                                )}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="history" className="space-y-4">
                <OrderChangeHistory
                  orderId={selectedOrder.id}
                  orderNumber={selectedOrder.orderNumber}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </Modal>

      {/* Create Order Modal */}
      <Modal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        type="form"
        title="Nouvelle Commande"
        description="Creer une nouvelle commande"
        icon={<Plus className="h-6 w-6 text-[#337957]" />}
        size="xl"
        actions={{
          primary: {
            label: isSubmitting ? "Enregistrement..." : "Enregistrer la commande",
            onClick: () => {
              const form = document.getElementById("order-form") as HTMLFormElement;
              if (form) form.requestSubmit();
            },
            disabled: isSubmitting,
            loading: isSubmitting,
          },
          secondary: {
            label: "Annuler",
            onClick: () => {
              setIsCreateModalOpen(false);
            },
            disabled: isSubmitting,
          },
        }}
      >
        <OrderForm
          onSubmit={async (formData) => {
            setIsSubmitting(true);
            try {
              const apiItems = formData.items
                .filter((item) => (item.productId != null) && item.quantity > 0)
                .map((item) => ({
                  productId: item.productId!,
                  productName: item.productName,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  amount: item.amount,
                  taxable: (item as any).isCustom ? (item as any).taxable !== false : undefined,
                  selectedOptions:
                    item.selectedOptions && Object.keys(item.selectedOptions).length > 0
                      ? item.selectedOptions
                      : undefined,
                  notes: item.notes || undefined,
                }));

              const payload: any = {
                clientInfo: {
                  firstName: formData.firstName,
                  lastName: formData.lastName,
                  email: formData.email,
                  phone: formData.phone,
                },
                pickupLocation: formData.pickupLocation,
                deliveryType: formData.deliveryType,
                items: apiItems,
                notes: formData.notes || undefined,
                paymentType: "full" as const,
                // Government clients pay by cheque/transfer later, so depositPaid MUST stay false
                depositPaid: formData.billingKind !== "gouvernement" && formData.paymentMethod === "in_store",
                paymentLinkChannel: formData.paymentLinkChannel,
                billingKind: formData.billingKind || "standard",
              };

              if (formData.date) {
                // Delivery time slot can be a range like "08:00 - 09:00";
                // only the HH:MM prefix is valid inside an ISO datetime.
                const startTime = (formData.pickupTime || "").match(/^(\d{2}):(\d{2})/);
                const hhmm = startTime ? `${startTime[1]}:${startTime[2]}` : "00:00";
                const pickupDateTime = `${formData.date}T${hhmm}:00`;
                payload.pickupDate = new Date(pickupDateTime).toISOString();
              }

              // Save deliveryTimeSlot for BOTH pickup and delivery so production
              // views display the chosen time reliably (avoids UTC hour drift).
              if (formData.pickupTime) {
                payload.deliveryTimeSlot = formData.pickupTime;
              }

              if (formData.deliveryType === "delivery" && formData.deliveryAddress) {
                payload.deliveryAddress = {
                  street: formData.deliveryAddress.street,
                  city: formData.deliveryAddress.city,
                  province: formData.deliveryAddress.province || "QC",
                  postalCode: formData.deliveryAddress.postalCode,
                };
                if (formData.date) {
                  payload.deliveryDate = formData.date;
                }
              }

              const result = await orderAPI.createOrder(payload);
              await fetchClients();
              const saved = result.data;
              const now = new Date().toISOString();

              const newOrder: OrderWithPacking = {
                id: saved?._id || String(Date.now()),
                orderNumber: saved?.orderNumber || generateFallbackOrderNumber(now),
                clientId: formData.clientId || 0,
                client: {
                  id: formData.clientId || 0,
                  firstName: formData.firstName,
                  lastName: formData.lastName,
                  email: formData.email,
                  phone: formData.phone,
                  status: "active",
                  createdAt: now,
                  updatedAt: now,
                  addresses: [],
                  orders: [],
                },
                orderDate: now,
                pickupDate: formData.date
                  ? (() => {
                      const m = (formData.pickupTime || "").match(/^(\d{2}):(\d{2})/);
                      const hhmm = m ? `${m[1]}:${m[2]}` : "00:00";
                      return new Date(`${formData.date}T${hhmm}:00`).toISOString();
                    })()
                  : now,
                // Mirror the payload: store the raw HH:MM the user typed so
                // the order list shows the right time immediately (no need to
                // refresh) — the pickupDate ISO would otherwise be re-projected
                // into Toronto and drift hours when the admin is in another TZ.
                deliveryTimeSlot: formData.pickupTime || undefined,
                pickupLocation: formData.pickupLocation,
                deliveryType: formData.deliveryType,
                deliveryAddress: formData.deliveryAddress
                  ? { id: 0, type: "shipping", ...formData.deliveryAddress, isDefault: false }
                  : undefined,
                items: formData.items
                  .filter((item) => (item.productId != null || (item as any).isCustom) && item.quantity > 0)
                  .map((item, idx) => ({
                    id: idx + 1,
                    orderId: 0,
                    productId: item.productId ?? 0,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    subtotal: item.amount,
                    taxable: (item as any).isCustom ? (item as any).taxable !== false : undefined,
                    productionStatus: "pending",
                    notes: item.notes || undefined,
                    selectedOptions:
                      item.selectedOptions && Object.keys(item.selectedOptions).length > 0
                        ? item.selectedOptions
                        : undefined,
                    product: {
                      id: item.productId ?? 0,
                      name: item.productName || ((item as any).isCustom ? "Item personnalisé" : `Produit #${item.productId}`),
                      price: item.unitPrice
                    },
                    isPacked: false
                  })),
                subtotal: saved?.subtotal ?? formData.subtotal,
                taxAmount: saved?.taxAmount ?? formData.taxAmount,
                deliveryFee: saved?.deliveryFee ?? formData.deliveryFee,
                total: saved?.total ?? formData.total,
                depositAmount: saved?.depositAmount ?? formData.depositAmount,
                depositPaid: formData.billingKind !== "gouvernement" && formData.paymentMethod === "in_store",
                balancePaid: formData.billingKind !== "gouvernement" && formData.paymentMethod === "in_store",
                paymentStatus: formData.billingKind !== "gouvernement" && formData.paymentMethod === "in_store" ? "paid" : "unpaid",
                status: "pending",
                source: "in_store",
                paymentMethod: formData.paymentMethod || "payment_link",
                paymentLinkChannel: formData.paymentLinkChannel || "email",
                notes: formData.notes || undefined,
                createdAt: now,
                updatedAt: now,
              };

              const isGovernment = formData.billingKind === "gouvernement";

              if (isGovernment) {
                // Government clients: no Square link, just facture email
                alert("Commande créée. La facture sera envoyée par courriel pour paiement par chèque ou virement.");
              } else if (newOrder.paymentMethod === "payment_link") {
                try {
                  const invoiceData = await sendPaymentLink(newOrder);
                  newOrder.squareInvoiceId = invoiceData?.invoiceId;
                  newOrder.notes = `${newOrder.notes ? `${newOrder.notes}\n` : ""}Square Invoice ID: ${invoiceData?.invoiceId}`;
                  alert(
                    newOrder.paymentLinkChannel === "sms"
                      ? "Lien de paiement envoye par SMS."
                      : "Lien de paiement envoye par courriel.",
                  );
                } catch (invoiceErr: any) {
                  console.error("Failed to send payment link:", invoiceErr);
                  alert(
                    "Commande creee, mais l'envoi du lien de paiement a echoue.",
                  );
                }
              }

              setOrders((prev) => {
                const next = [newOrder, ...prev];
                setFilteredOrders(applyOrderFilters(next));
                return next;
              });
              setIsCreateModalOpen(false);
            } catch (err: any) {
              console.error("Failed to create order:", err);
              alert(err.message || "Erreur lors de la creation de la commande");
            } finally {
              setIsSubmitting(false);
            }
          }}
          onCancel={() => {
            setIsCreateModalOpen(false);
          }}
          clients={clients}
          pricingBaseline={undefined}
          isSubmitting={isSubmitting}
        />
      </Modal>

      {/* Edit Order Modal */}
      <Modal
        open={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        type="form"
        title="Modifier la Commande"
        description="Modifier les informations de la commande"
        icon={<Edit className="h-6 w-6 text-blue-500" />}
        size="xl"
        actions={{
          primary: {
            label: isSubmitting ? "Enregistrement..." : "Enregistrer les modifications",
            onClick: () => {
              const form = document.getElementById("order-form") as HTMLFormElement;
              if (form) form.requestSubmit();
            },
            disabled: isSubmitting,
            loading: isSubmitting,
          },
          secondary: {
            label: "Annuler",
            onClick: () => {
              setIsEditModalOpen(false);
              setSelectedOrder(null);
            },
            disabled: isSubmitting,
          },
        }}
      >
        <OrderForm
          onSubmit={async (formData) => {
            setIsSubmitting(true);
            try {
              if (!selectedOrder) {
                throw new Error("Aucune commande sélectionnée");
              }

              const apiItems = formData.items
                .filter((item) => (item.productId != null || (item as any).isCustom) && item.quantity > 0)
                .map((item) => ({
                  productId: item.productId ?? 0,
                  productName: item.productName || ((item as any).isCustom ? "Item personnalisé" : `Produit #${item.productId}`),
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  amount: item.amount,
                  taxable: (item as any).isCustom ? (item as any).taxable !== false : undefined,
                  selectedOptions:
                    item.selectedOptions && Object.keys(item.selectedOptions).length > 0
                      ? item.selectedOptions
                      : undefined,
                  notes: item.notes || undefined,
                }));

              const payload: any = {
                clientInfo: {
                  firstName: formData.firstName,
                  lastName: formData.lastName,
                  email: formData.email,
                  phone: formData.phone,
                },
                pickupLocation: formData.pickupLocation,
                deliveryType: formData.deliveryType,
                items: apiItems,
                notes: formData.notes || undefined,
                paymentLinkChannel: formData.paymentLinkChannel,
              };

              if (formData.date) {
                // Delivery time slot can be a range like "08:00 - 09:00";
                // only the HH:MM prefix is valid inside an ISO datetime.
                const startTime = (formData.pickupTime || "").match(/^(\d{2}):(\d{2})/);
                const hhmm = startTime ? `${startTime[1]}:${startTime[2]}` : "00:00";
                const pickupDateTime = `${formData.date}T${hhmm}:00`;
                payload.pickupDate = new Date(pickupDateTime).toISOString();
              }

              // Save deliveryTimeSlot for BOTH pickup and delivery so production
              // views display the chosen time reliably (avoids UTC hour drift).
              if (formData.pickupTime) {
                payload.deliveryTimeSlot = formData.pickupTime;
              }

              if (formData.deliveryType === "delivery" && formData.deliveryAddress) {
                payload.deliveryAddress = {
                  street: formData.deliveryAddress.street,
                  city: formData.deliveryAddress.city,
                  province: formData.deliveryAddress.province || "QC",
                  postalCode: formData.deliveryAddress.postalCode,
                };
                if (formData.date) {
                  payload.deliveryDate = formData.date;
                }
              }

              const result = await orderAPI.updateOrder(selectedOrder.id, payload);
              const saved = result?.data;

              const updatedOrder: OrderWithPacking = {
                ...selectedOrder,
                client: {
                  ...selectedOrder.client,
                  firstName: formData.firstName,
                  lastName: formData.lastName,
                  email: formData.email,
                  phone: formData.phone,
                },
                pickupDate: payload.pickupDate || selectedOrder.pickupDate,
                deliveryTimeSlot: formData.pickupTime || selectedOrder.deliveryTimeSlot,
                pickupLocation: formData.pickupLocation,
                deliveryType: formData.deliveryType,
                deliveryAddress:
                  formData.deliveryType === "delivery" && formData.deliveryAddress
                    ? {
                        id: selectedOrder.deliveryAddress?.id || 0,
                        type: "shipping",
                        street: formData.deliveryAddress.street,
                        city: formData.deliveryAddress.city,
                        province: formData.deliveryAddress.province,
                        postalCode: formData.deliveryAddress.postalCode,
                        isDefault: selectedOrder.deliveryAddress?.isDefault || false,
                      }
                    : undefined,
                items: formData.items
                  .filter((item) => (item.productId != null || (item as any).isCustom) && item.quantity > 0)
                  .map((item, idx) => ({
                    id: idx + 1,
                    productId: item.productId ?? 0,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    subtotal: item.amount,
                    taxable: (item as any).isCustom ? (item as any).taxable !== false : undefined,
                    productionStatus: "pending",
                    notes: item.notes || undefined,
                    product: {
                      id: item.productId ?? 0,
                      name: item.productName || ((item as any).isCustom ? "Item personnalisé" : `Produit #${item.productId}`),
                      price: item.unitPrice,
                    },
                    isPacked: false,
                  })),
                subtotal: saved?.subtotal ?? formData.subtotal,
                taxAmount: saved?.taxAmount ?? formData.taxAmount,
                deliveryFee: saved?.deliveryFee ?? formData.deliveryFee,
                total: saved?.total ?? formData.total,
                depositAmount: saved?.depositAmount ?? formData.depositAmount,
                notes: formData.notes || undefined,
                updatedAt: saved?.updatedAt || new Date().toISOString(),
                amountPaid: saved?.amountPaid ?? (selectedOrder as any).amountPaid ?? 0,
              } as any;

              // Calculate balance notification
              const newTotal = saved?.total ?? formData.total;
              const paidAmount = saved?.amountPaid ?? (selectedOrder as any).amountPaid ?? 0;

              // Update payment status based on paid vs new total
              if (paidAmount > 0.01) {
                if (newTotal <= paidAmount) {
                  // Fully paid or overpaid (refund case)
                  updatedOrder.paymentStatus = "paid";
                  updatedOrder.depositPaid = true;
                  updatedOrder.balancePaid = true;
                } else {
                  // Balance remaining — not fully paid
                  updatedOrder.paymentStatus = "deposit_paid";
                  updatedOrder.depositPaid = true;
                  updatedOrder.balancePaid = false;
                }
              }

              setOrders((prev) => {
                const next = prev.map((order) =>
                  order.id === selectedOrder.id ? updatedOrder : order,
                );
                setFilteredOrders(applyOrderFilters(next));
                return next;
              });

              // Show balance notification if client already paid
              if (paidAmount > 0.01) {
                const diff = newTotal - paidAmount;
                const clientName = `${formData.firstName} ${formData.lastName}`;
                if (diff > 0.01) {
                  // Balance remaining — ask how to collect
                  setBalancePaymentModal({
                    open: true,
                    order: updatedOrder,
                    amount: diff,
                    clientName,
                  });
                } else if (diff < -0.01) {
                  setEditNotification({
                    type: "refund",
                    amount: Math.abs(diff),
                    clientName,
                  });
                  setTimeout(() => setEditNotification(null), 8000);
                } else {
                  setEditNotification({ type: "nochange", amount: 0, clientName });
                  setTimeout(() => setEditNotification(null), 4000);
                }
              } else if (
                formData.billingKind !== "gouvernement" &&
                updatedOrder.paymentMethod === "payment_link" &&
                updatedOrder.squareInvoiceId &&
                updatedOrder.paymentStatus !== "paid" &&
                Math.abs(newTotal - (selectedOrder.total || 0)) > 0.01
              ) {
                // Order has pending invoice, total changed → cancel old + send new
                try {
                  await fetch(`${normalizedApiUrl}/api/payments/cancel-invoice`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ orderId: updatedOrder.id }),
                  });
                  const invoiceData = await sendPaymentLink(updatedOrder);
                  updatedOrder.squareInvoiceId = invoiceData?.invoiceId;
                  setOrders((prev) => {
                    const next = prev.map((o) =>
                      o.id === updatedOrder.id ? updatedOrder : o,
                    );
                    setFilteredOrders(applyOrderFilters(next));
                    return next;
                  });
                  alert(
                    `Un nouveau lien de paiement a été envoyé à ${updatedOrder.client.email} pour le nouveau total.`,
                  );
                } catch (err: any) {
                  console.error("Failed to resend payment link:", err);
                  alert(
                    `Commande modifiée, mais l'envoi du nouveau lien a échoué: ${err?.message || err}`,
                  );
                }
              }

              setIsEditModalOpen(false);
              setSelectedOrder(null);
            } catch (err: any) {
              console.error(err);
              alert(err?.message || "Erreur lors de la modification de la commande");
            } finally {
              setIsSubmitting(false);
            }
          }}
          onCancel={() => {
            setIsEditModalOpen(false);
            setSelectedOrder(null);
          }}
          initialData={
            selectedOrder
              ? {
                  date: (selectedOrder.pickupDate || selectedOrder.orderDate).split("T")[0],
                  pickupTime: (() => {
                    const d = new Date(selectedOrder.pickupDate);
                    const h = d.getHours().toString().padStart(2, "0");
                    const mins = d.getMinutes();
                    const m = mins < 15 ? "00" : mins < 45 ? "30" : "00";
                    const finalH = mins >= 45 ? (d.getHours() + 1).toString().padStart(2, "0") : h;
                    return `${finalH}:${m}`;
                  })(),
                  clientId: selectedOrder.clientId,
                  firstName: selectedOrder.client.firstName,
                  lastName: selectedOrder.client.lastName,
                  phone: selectedOrder.client.phone,
                  email: selectedOrder.client.email,
                  pickupLocation: selectedOrder.pickupLocation,
                  deliveryType: selectedOrder.deliveryType,
                  notes: selectedOrder.notes || "",
                  paymentMethod: selectedOrder.paymentMethod || "in_store",
                  paymentLinkChannel: selectedOrder.paymentLinkChannel || "email",
                  deliveryFee: selectedOrder.deliveryFee,
                  deliveryAddress: selectedOrder.deliveryAddress
                    ? {
                        street: selectedOrder.deliveryAddress.street,
                        city: selectedOrder.deliveryAddress.city,
                        province: selectedOrder.deliveryAddress.province,
                        postalCode: selectedOrder.deliveryAddress.postalCode,
                      }
                    : undefined,
                  items: selectedOrder.items.map(item => ({
                    id: `edit-${item.id}`,
                    productId: item.productId,
                    productName: item.product?.name || `Produit #${item.productId}`,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    amount: item.subtotal,
                    taxable: item.taxable,
                    notes: item.notes || "",
                    selectedOptions: (item as any).selectedOptions || undefined,
                    isPacked: item.productionStatus === "ready"
                  }))
                }
              : undefined
          }
          clients={clients}
          isSubmitting={isSubmitting}
        />
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        type="warning"
        title="Confirmer la suppression"
        description="Cette action est irreversible"
        icon={<Trash2 className="h-6 w-6 text-red-600" />}
        actions={{
          primary: {
            label: "Supprimer",
            onClick: handleDelete,
            variant: "destructive",
            disabled: isSubmitting,
            loading: isSubmitting,
          },
          secondary: {
            label: "Annuler",
            onClick: () => {
              setIsDeleteModalOpen(false);
              setOrderToDelete(null);
            },
            disabled: isSubmitting,
          },
        }}
      >
        {orderToDelete && (
          <div className="space-y-4">
            <p className="text-gray-700">
              Etes-vous sur de vouloir supprimer cette commande ?
            </p>
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="space-y-2">
                <p className="font-medium text-gray-900">
                  {formatOrderNumber(orderToDelete.orderNumber)}
                </p>
                <p className="text-sm text-gray-600">
                  Client: {orderToDelete.client.firstName}{" "}
                  {orderToDelete.client.lastName}
                </p>
                <p className="text-sm text-gray-600">
                  Total: {formatCurrency(orderToDelete.total)}
                </p>
                <p className="text-sm text-gray-600">
                  Statut: {getStatusBadge(orderToDelete.status)}
                </p>
                <p className="text-sm text-gray-600">
                  Paiement: {getPaymentBadge(orderToDelete.paymentStatus, orderToDelete)}
                </p>
              </div>
            </div>
            <p className="text-sm text-red-600">
              Cette action est irreversible. Toutes les donnees associees a
              cette commande seront perdues.
            </p>
          </div>
        )}
      </Modal>

      {/* Refund Confirmation Modal */}
      <Modal
        open={isCancelModalOpen}
        onOpenChange={setIsCancelModalOpen}
        type="warning"
        title="Rembourser la commande"
        description="Le remboursement sera execute via Square"
        icon={<XCircle className="h-6 w-6 text-amber-600" />}
        actions={{
          primary: {
            label: isSubmitting
              ? "Remboursement en cours… (ne pas recliquer)"
              : "Rembourser via Square",
            onClick: handleRefund,
            variant: "destructive",
            disabled: isSubmitting || !refundEmployeeName.trim(),
            loading: isSubmitting,
          },
          secondary: {
            label: "Retour",
            onClick: () => {
              setIsCancelModalOpen(false);
              setOrderToCancel(null);
            },
            disabled: isSubmitting,
          },
        }}
      >
        {orderToCancel && (
          <div className="space-y-4">
            <p className="text-gray-700">
              Etes-vous sur de vouloir rembourser cette commande via Square ?
            </p>
            <div>
              <Label className="text-sm font-semibold text-gray-800">
                Votre nom (employé qui effectue le remboursement) *
              </Label>
              <Input
                type="text"
                placeholder="ex: Marie Dupont"
                value={refundEmployeeName}
                onChange={(e) => setRefundEmployeeName(e.target.value)}
                className="mt-1"
                autoFocus
              />
              {!refundEmployeeName.trim() && (
                <p className="text-xs text-red-500 mt-1">
                  Obligatoire — ce nom sera enregistré dans l'historique de la commande.
                </p>
              )}
            </div>
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="space-y-2">
                <p className="font-medium text-gray-900">
                  {formatOrderNumber(orderToCancel.orderNumber)}
                </p>
                <p className="text-sm text-gray-600">
                  Client: {orderToCancel.client.firstName}{" "}
                  {orderToCancel.client.lastName}
                </p>
                <p className="text-sm text-gray-600">
                  Total: {formatCurrency(orderToCancel.total)}
                </p>
                <p className="text-sm text-gray-600">
                  Paiement: {getPaymentBadge(orderToCancel.paymentStatus, orderToCancel)}
                </p>
              </div>
            </div>
            <p className="text-sm text-amber-600">
              Cette action est sensible. Le remboursement sera tente sur le paiement Square de la commande.
            </p>
          </div>
        )}
      </Modal>

      {/* Balance Refund Modal */}
      <Modal
        open={isBalanceRefundModalOpen}
        onOpenChange={setIsBalanceRefundModalOpen}
        type="form"
        title="Remboursement de balance"
        description={balanceRefundOrder ? `Commande ${formatOrderNumber(balanceRefundOrder.orderNumber)}` : ""}
        icon={<Undo2 className="h-6 w-6 text-green-600" />}
        actions={{
          secondary: {
            label: "Fermer",
            onClick: () => {
              setIsBalanceRefundModalOpen(false);
              setBalanceRefundOrder(null);
            },
          },
        }}
      >
        {balanceRefundOrder && (() => {
          const paidAmount = (balanceRefundOrder as any).amountPaid || 0;
          const refundAmount = paidAmount - balanceRefundOrder.total;
          const hasSquarePayment = !!(balanceRefundOrder.squarePaymentId || balanceRefundOrder.squareInvoiceId);

          const confirmRefund = async (method: "in_store" | "square") => {
            if (!balanceRefundEmployee.trim()) {
              alert("Veuillez entrer votre nom");
              return;
            }
            setIsSubmitting(true);
            try {
              if (method === "square" && hasSquarePayment) {
                const response = await fetch(`${normalizedApiUrl}/api/payments/refund-balance`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({
                    orderId: balanceRefundOrder.id,
                    amount: refundAmount,
                    employeeName: balanceRefundEmployee.trim(),
                  }),
                });
                const result = await response.json();
                if (!response.ok || !result.success) {
                  throw new Error(result.error || "Échec du remboursement Square");
                }
              }

              const refundEntry = {
                refundedAt: new Date().toISOString(),
                employeeName: balanceRefundEmployee.trim(),
                amountCents: Math.round(refundAmount * 100),
                reason: method === "in_store" ? "Remboursement en magasin" : "Remboursement via Square",
                refundStatus: "completed",
              };

              // Persist refund + amountPaid to backend
              await orderAPI.updateOrder(balanceRefundOrder.id, {
                amountPaid: balanceRefundOrder.total,
                refunds: [refundEntry],
              } as any);

              setOrders((prev) => {
                const next = prev.map((o) => {
                  if (o.id !== balanceRefundOrder.id) return o;
                  const existingRefunds = (o as any).refunds || [];
                  return { ...o, amountPaid: o.total, refunds: [...existingRefunds, refundEntry] } as any;
                });
                setFilteredOrders(applyOrderFilters(next));
                return next;
              });

              setEditNotification({
                type: "refund",
                amount: refundAmount,
                clientName: `${balanceRefundOrder.client.firstName} ${balanceRefundOrder.client.lastName}`,
              });
              setTimeout(() => setEditNotification(null), 6000);

              setIsBalanceRefundModalOpen(false);
              setBalanceRefundOrder(null);
            } catch (err: any) {
              alert(err?.message || "Erreur lors du remboursement");
            } finally {
              setIsSubmitting(false);
            }
          };

          return (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <p className="text-sm text-green-600 mb-1">Montant à rembourser</p>
                <p className="text-3xl font-black text-green-700">{formatCurrency(refundAmount)}</p>
                <p className="text-xs text-green-500 mt-1">
                  Payé: {formatCurrency(paidAmount)} — Nouveau total: {formatCurrency(balanceRefundOrder.total)}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
                  Nom de la personne qui rembourse *
                </label>
                <input
                  type="text"
                  value={balanceRefundEmployee}
                  onChange={(e) => setBalanceRefundEmployee(e.target.value)}
                  placeholder="Entrez votre nom"
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none text-sm"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <button
                  disabled={isSubmitting || !balanceRefundEmployee.trim()}
                  onClick={() => confirmRefund("in_store")}
                  className="flex flex-col items-center gap-1 p-4 rounded-xl border-2 border-green-300 bg-green-50 hover:bg-green-100 transition-all text-center disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span className="font-bold text-sm text-green-800">Remboursé en magasin</span>
                  )}
                  <span className="text-xs text-green-600">Confirmer le remboursement en main propre</span>
                </button>

                {hasSquarePayment && (
                  <button
                    disabled={isSubmitting || !balanceRefundEmployee.trim()}
                    onClick={() => confirmRefund("square")}
                    className="flex flex-col items-center gap-1 p-4 rounded-xl border-2 border-blue-300 bg-blue-50 hover:bg-blue-100 transition-all text-center disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span className="font-bold text-sm text-blue-800">Rembourser via Square</span>
                    )}
                    <span className="text-xs text-blue-600">Remboursement sur la carte du client</span>
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* In-store full refund modal — for orders paid in boutique only */}
      <Modal
        open={isStoreRefundModalOpen}
        onOpenChange={(o) => {
          if (!o) {
            setIsStoreRefundModalOpen(false);
            setStoreRefundOrder(null);
            setStoreRefundEmployee("");
            setStoreRefundReason("");
          }
        }}
        type="form"
        title="Remboursement en magasin"
        description={
          storeRefundOrder
            ? `Commande ${formatOrderNumber(storeRefundOrder.orderNumber)} — ${storeRefundOrder.client.firstName} ${storeRefundOrder.client.lastName}`
            : ""
        }
        icon={<Store className="h-6 w-6 text-amber-600" />}
        actions={{
          primary: {
            label: isProcessingStoreRefund ? "Enregistrement..." : "Confirmer le remboursement",
            onClick: submitStoreRefund,
            disabled:
              isProcessingStoreRefund ||
              !storeRefundEmployee.trim() ||
              !storeRefundOrder,
            loading: isProcessingStoreRefund,
          },
          secondary: {
            label: "Annuler",
            onClick: () => {
              setIsStoreRefundModalOpen(false);
              setStoreRefundOrder(null);
              setStoreRefundEmployee("");
              setStoreRefundReason("");
            },
            disabled: isProcessingStoreRefund,
          },
        }}
      >
        {storeRefundOrder && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <p className="text-xs uppercase tracking-wider text-amber-600 mb-1">
                Montant à rembourser en boutique
              </p>
              <p className="text-3xl font-black text-amber-700">
                {formatCurrency(storeRefundOrder.total)}
              </p>
              <p className="text-xs text-amber-600 mt-1">
                Aucun appel à Square — l'argent est rendu en main propre. La
                commande passera à <strong>annulée</strong>.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Nom de la personne qui rembourse *
              </label>
              <input
                type="text"
                value={storeRefundEmployee}
                onChange={(e) => setStoreRefundEmployee(e.target.value)}
                placeholder="Entrez votre nom"
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none text-sm"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Raison (optionnel)
              </label>
              <textarea
                value={storeRefundReason}
                onChange={(e) => setStoreRefundReason(e.target.value)}
                placeholder="Ex: client a annulé sur place, produit défectueux, etc."
                rows={2}
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none text-sm resize-none"
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
