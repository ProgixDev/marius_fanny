// Staff Management Types
export interface Staff {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: "Montreal" | "Laval";
  department: "customer_service" | "kitchen_staff";
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
}

export type StaffFormData = Pick<
  Staff,
  "email" | "phone" | "location" | "department"
>;

// Product Management specific interface
export interface Product {
  id: number;
  name: string;
  category: string[];
  price: number;
  discountPercentage?: number;
  available: boolean;
  minOrderQuantity: number;
  maxOrderQuantity: number;
  description?: string;
  image?: string;
  images?: string[];
  createdAt: string;
  updatedAt: string;
  sales?: number;
  revenue?: number;
  preparationTimeHours?: number; // Hours required to prepare the product
  availableDays?: number[]; // 0-6 (Sunday-Saturday)
  hasTaxes?: boolean;
  allergens?: string;
  productionType: "patisserie" | "cuisinier" | "four";
  targetAudience: "clients" | "pro";
  customOptions?: Array<{
    name: string;
    type?: "choice" | "text";
    choices: string[];
  }>;
  recommendations?: number[]; // IDs des produits recommandés
  displayOrder?: number;
}

// Category Management Types
export interface Category {
  id: number;
  name: string;
  description?: string;
  image?: string;
  parentId?: number;
  displayOrder: number;
  active: boolean;
  isBanner?: boolean;
  bannerColor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryData {
  name: string;
  description?: string;
  image?: string;
  parentId?: number;
  displayOrder?: number;
  isBanner?: boolean;
  bannerColor?: string;
}

export interface UpdateCategoryData {
  name?: string;
  description?: string;
  image?: string;
  parentId?: number;
  displayOrder?: number;
  active?: boolean;
  isBanner?: boolean;
  bannerColor?: string;
}

// Statistics Types
export interface Statistics {
  totalProducts: number;
  totalRevenue: number;
  lowStock: number;
  totalSales: number;
  revenueChange: number;
  salesChange: number;
}

// Client Management Types
export interface Client {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: "active" | "inactive" | "placeholder";
  billing?: {
    kind: "standard" | "representant" | "gouvernement";
    organization?: string;
    invoiceEmail?: string;
    paymentTermsDays: number;
    allowUnpaidOrders: boolean;
  };
  createdAt: string;
  updatedAt: string;
  addresses: Address[];
  orders: Order[];
}

export interface Address {
  id: number;
  type: "billing" | "shipping";
  street: string;
  city: string;
  province: string;
  postalCode: string;
  isDefault: boolean;
}

export type ClientFormData = Omit<
  Client,
  "id" | "createdAt" | "updatedAt" | "orders" | "addresses"
>;

export interface Order {
  id: string; 
  orderNumber: string;
  clientId: number;
  client: Client;
  orderDate: string;
  pickupDate: string;
  pickupLocation: "Montreal" | "Laval";
  deliveryType: "pickup" | "delivery";
  deliveryDate?: string;
  deliveryTimeSlot?: string;
  deliveryAddress?: Address;
  deliverySlot?: string;
  items: OrderItem[];
  subtotal: number;
  taxAmount: number;
  deliveryFee: number;
  total: number;
  depositAmount: number;
  depositPaid: boolean;
  depositPaidAt?: string;
  balancePaid: boolean;
  balancePaidAt?: string;
  paymentStatus: "unpaid" | "deposit_paid" | "paid";
  amountPaid?: number;
  paymentLinkChannel?: "email" | "sms";
  billingKind?: "standard" | "representant" | "gouvernement";
  billingOrganization?: string;
  billingEmail?: string;
  paymentDueDate?: string;
  squarePaymentId?: string;
  squareInvoiceId?: string;
  refunds?: Array<{
    refundedAt: string;
    employeeName: string;
    employeeId?: string;
    paymentId: string;
    refundId?: string;
    refundStatus?: string;
    amountCents: number;
    reason?: string;
  }>;
  status: 
    | "pending"
    | "confirmed"
    | "in_production"
    | "ready"
    | "completed"
    | "cancelled"
    | "delivered";
  source: "online" | "phone" | "in_store";
  notes?: string;
  staffId?: number;
  interLocationDeliveryDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: number;
  orderId: number;
  productId: number;
  product?: Product;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  taxable?: boolean;
  notes?: string;
  selectedOptions?: Record<string, string>;
  productionStatus: "pending" | "in_progress" | "ready";
  readyAt?: string;
}

export interface OrderFormData {
  clientId?: number;
  clientInfo?: {
    firstName: string;
    lastName: string;
    email?: string;
    phone: string;
  };
  pickupDate: string;
  pickupLocation: "Montreal" | "Laval";
  deliveryType: "pickup" | "delivery";
  deliveryDate?: string;
  deliveryTimeSlot?: string;
  deliveryAddressId?: number;
  deliverySlot?: string;
  items: {
    productId: number;
    quantity: number;
    notes?: string;
  }[];
  notes?: string;
  depositPaid: boolean;
}

export interface SimplifiedOrder {
  id: string;
  orderNumber: string;
  client: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
  };
  items: Array<{
    product?: {
      id: string;
      name: string;
      price: number;
    };
    quantity: number;
    unitPrice: number;
  }>;
  total: number;
  status: "pending" | "in_production" | "ready" | "delivered" | "cancelled" | "completed";
  createdAt: string;
  notes?: string;
}

export interface DeliveryZone {
  id: number;
  name: string;
  postalCodePrefixes: string[];
  deliveryFee: number;
  minimumOrder: number;
  active: boolean;
}

export interface DeliverySlot {
  id: number;
  startTime: string;
  endTime: string;
  maxOrders: number;
  availableDays: number[]; // 0-6, Sunday-Saturday
  active: boolean;
}

// Production Management
export interface ProductionListItem {
  productId: number;
  productName: string;
  totalQuantity: number;
  orders: {
    orderId: number;
    orderNumber: string;
    quantity: number;
    notes?: string;
    pickupDate: string;
    pickupLocation: string;
    status: OrderItem["productionStatus"];
  }[];
}

export interface DailyInventory {
  id: number;
  productId: number;
  product: Product;
  date: string;
  quantity: number;
  location: "Montreal" | "Laval";
  createdAt: string;
}

// Delivery Schedule
export interface InterLocationDelivery {
  id: number;
  deliveryDate: string;
  fromLocation: "Laval";
  toLocation: "Montreal";
  orders: Order[];
  status: "scheduled" | "in_transit" | "delivered";
  deliveredAt?: string;
}

// Statistics & Dashboard
export interface OrderStatistics {
  totalOrders: number;
  pendingOrders: number;
  inProductionOrders: number;
  readyOrders: number;
  todayRevenue: number;
  weekRevenue: number;
  monthRevenue: number;
  averageOrderValue: number;
}

// Types pour le staff dashboard
export interface OrderStats {
  today: number;
  thisWeek: number;
  pending: number;
  inProduction: number;
  ready: number;
  delivered: number;
  cancelled: number;
  totalRevenue: number;
  averageOrderValue: number;
}

export interface TimeSeriesData {
  date: string;
  orders: number;
  revenue: number;
}

export interface ProductSales {
  product: string;
  sales: number;
  revenue: number;
}

export interface ClientActivity {
  client: string;
  orders: number;
  totalSpent: number;
}

export interface DashboardClient {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address?: string; // Added for staff dashboard compatibility
}

export interface DashboardOrderItem {
  product?: {
    id: string;
    name: string;
    price: number;
  };
  quantity: number;
  unitPrice: number;
}

export interface DashboardOrder {
  id: string;
  orderNumber: string;
  client: DashboardClient;
  items: DashboardOrderItem[];
  total: number;
  status: "pending" | "in_production" | "ready" | "delivered" | "cancelled";
  createdAt: string;
  notes?: string;
}
export interface UserWithRole {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string | null;
  role?: "user" | "pro" | "staff" | "customerService" | "admin" | "deliveryDriver" | "cuisinier" | "patissier" | "four" | "vendeur";
  user_metadata?: {
    [key: string]: any;
  }; 
}


// Type guard pour vérifier si un objet est un Order
export function isOrder(obj: any): obj is Order {
  return obj && 
         typeof obj.id === 'string' && 
         typeof obj.orderNumber === 'string' &&
         obj.client !== undefined;
}

// Helper function to ensure order.id is always a string
export function getOrderId(order: Order): string {
  return typeof order.id === 'string' ? order.id : String(order.id);
}
