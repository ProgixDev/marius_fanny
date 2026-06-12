import React, { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Check, ChevronsUpDown, Package, StickyNote, Lock } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Checkbox } from "./ui/checkbox";
import { productAPI } from "../lib/ProductAPI";
import type { Client, Address, Product } from "../types";
import { TAX_RATE } from "../data";
import {
  calculateDeliveryFee,
  validateMinimumOrder,
  DELIVERY_ZONES,
} from "../utils/deliveryZones";
import { getAvailableTimeSlots } from "../utils/timeSlots";
import { calculatePriceWithOptions } from "../utils/customOptions";
import { getImageUrl } from "../utils/api";

interface OrderFormProps {
  onSubmit: (formData: OrderFormData) => void;
  onCancel: () => void;
  initialData?: Partial<OrderFormData>;
  pricingBaseline?: {
    total: number;
    depositAmount: number;
    paymentStatus: "unpaid" | "deposit_paid" | "paid";
  };
  isSubmitting?: boolean;
  clients?: Client[];
  onViewProducts?: () => void;
}

interface OrderFormData {
  date: string;
  pickupTime: string;
  clientId?: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  items: OrderFormItem[];
  notes: string;
  pickupLocation: "Montreal" | "Laval";
  deliveryType: "pickup" | "delivery";
  deliveryAddress?: {
    street: string;
    city: string;
    province: string;
    postalCode: string;
  };
  billingAddress?: {
    street: string;
    city: string;
    province: string;
    postalCode: string;
    sameAsDelivery?: boolean;
  };
  subtotal: number;
  taxAmount: number;
  deliveryFee: number;
  total: number;
  depositAmount: number;
  balance: number;
  paymentMethod: "in_store" | "payment_link";
  paymentLinkChannel: "email" | "sms";
  billingKind?: "standard" | "representant" | "gouvernement";
  billingEmail?: string;
}

interface OrderFormItem {
  id: string;
  productId: number | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxable?: boolean;
  notes: string;
  selectedOptions?: Record<string, string>;
  isPacked?: boolean;
  isCustom?: boolean;
  customDescription?: string;
}

export default function OrderForm({
  onSubmit,
  onCancel,
  initialData,
  pricingBaseline,
  isSubmitting = false,
  clients = [],
  onViewProducts,
}: OrderFormProps) {
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

  const [formData, setFormData] = useState<OrderFormData>(() => {
    const initialItems = initialData?.items?.map(item => ({
      ...item,
      taxable: item.taxable,
      isPacked: false
    })) || [];
    
    return {
      date: initialData?.date || new Date().toISOString().split("T")[0],
      pickupTime: initialData?.pickupTime || "",
      clientId: initialData?.clientId,
      firstName: initialData?.firstName || "",
      lastName: initialData?.lastName || "",
      phone: initialData?.phone || "",
      email: initialData?.email || "",
      items: initialItems,
      notes: initialData?.notes || "",
      pickupLocation: initialData?.pickupLocation || "Laval",
      deliveryType: initialData?.deliveryType || "pickup",
      deliveryAddress: initialData?.deliveryAddress,
      billingAddress: initialData?.billingAddress || {
        street: "",
        city: "",
        province: "",
        postalCode: "",
        sameAsDelivery: (initialData?.deliveryType || "pickup") === "delivery",
      },
      subtotal: 0,
      taxAmount: 0,
      deliveryFee: initialData?.deliveryFee || 0,
      total: 0,
      depositAmount: 0,
      balance: 0,
      paymentMethod: initialData?.paymentMethod || "in_store",
      paymentLinkChannel: initialData?.paymentLinkChannel || "email",
      billingKind: initialData?.billingKind || "standard",
      billingEmail: initialData?.billingEmail || "",
    };
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSearch, setEmailSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(
    null,
  );
  const [selectedBillingAddressId, setSelectedBillingAddressId] = useState<
    number | null
  >(null);
  const [deliveryZoneInfo, setDeliveryZoneInfo] = useState<{
    zoneName: string;
    fee: number;
    minimumOrder: number;
    isValid: boolean;
  } | null>(null);
  const [minimumOrderError, setMinimumOrderError] = useState<string>("");
  const [deliveryPostalOpen, setDeliveryPostalOpen] = useState(false);
  const [billingPostalOpen, setBillingPostalOpen] = useState(false);
  const [expandedNoteItemIds, setExpandedNoteItemIds] = useState<Set<string>>(
    new Set(),
  );

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [activePosCategory, setActivePosCategory] = useState<string>("all");
  const preparationWarnings = useMemo(() => {
    if (!formData.date) return [] as { itemId: string; label: string }[];

    const warnings: { itemId: string; label: string }[] = [];
    for (const item of formData.items) {
      if (!item.productId || item.isCustom) continue;
      if (!validatePreparationTime(formData.date, item.productId, formData.pickupTime)) {
        const product = products.find((p) => p.id === item.productId);
        const warning =
          getPreparationTimeWarning(item.productId) ||
          "Délai de préparation insuffisant pour la date sélectionnée.";
        warnings.push({
          itemId: item.id,
          label: `${product?.name || `Produit #${item.productId}`}: ${warning}`,
        });
      }
    }
    return warnings;
  }, [formData.date, formData.pickupTime, formData.items, products]);

  const editPaymentAdjustment = useMemo(() => {
    if (!pricingBaseline) return null;

    const estimatedPaidAmount =
      pricingBaseline.paymentStatus === "paid"
        ? pricingBaseline.total
        : pricingBaseline.paymentStatus === "deposit_paid"
          ? pricingBaseline.depositAmount
          : 0;

    const totalDifference = formData.total - pricingBaseline.total;
    const outstandingDifference = formData.total - estimatedPaidAmount;

    return {
      totalDifference,
      outstandingDifference,
    };
  }, [pricingBaseline, formData.total]);

  useEffect(() => {
    fetchProducts();
  }, []);

  // When editing, auto-bind selectedClient from initialData so the 4 client
  // fields stay locked (prevents the name-swap bug).
  useEffect(() => {
    if (selectedClient) return;
    const targetEmail = (initialData?.email || "").trim().toLowerCase();
    const targetId = initialData?.clientId;
    if (!targetEmail && !targetId) return;
    const match = clients.find(
      (c) =>
        (targetId && c.id === targetId) ||
        (targetEmail && (c.email || "").trim().toLowerCase() === targetEmail),
    );
    if (match) {
      setSelectedClient(match);
      setEmailSearch(match.email);
    }
  }, [clients, initialData?.email, initialData?.clientId, selectedClient]);

  useEffect(() => {
    if (formData.deliveryType === "pickup") {
      setFormData((prev) => ({
        ...prev,
        billingAddress: undefined,
      }));
    }
  }, [formData.deliveryType]);

  const fetchProducts = async () => {
    try {
      setProductsLoading(true);
      const response = await productAPI.getAllProducts(1, 1000);
      setProducts(response.data.products.filter(p => p.available));
    } catch (error) {
      console.error('Failed to fetch products:', error);
    } finally {
      setProductsLoading(false);
    }
  };

  useEffect(() => {
    const subtotal = formData.items.reduce((sum, item) => sum + item.amount, 0);

    // Tax exemption rule: when 6+ viennoiseries/pâtisseries (any mix), they become tax-exempt
    const categoryText = (product: any): string => {
      if (!product) return "";
      const cat = (product as any).category;
      if (Array.isArray(cat)) return cat.join(" ").toLowerCase();
      return String(cat || "").toLowerCase();
    };

    const bakedGoodsCount = formData.items.reduce((sum, item) => {
      if (item.isCustom) return sum;
      const product = products.find((p) => p.id === item.productId);
      if (!product) return sum;
      const cat = categoryText(product);
      const isViennoiserie = cat.includes("viennoiser");
      const isPatisserie =
        (product as any).productionType === "patisserie" || cat.includes("patisser");
      if (isViennoiserie || isPatisserie) {
        return sum + item.quantity;
      }
      return sum;
    }, 0);
    const bakedGoodsExempt = bakedGoodsCount >= 6;

    const taxableSubtotal = formData.items.reduce((sum, item) => {
      if (item.isCustom) {
        return sum + (item.taxable === false ? 0 : item.amount);
      }
      const product = products.find((p) => p.id === item.productId);
      const hasTaxes = product?.hasTaxes !== undefined ? product.hasTaxes : true;
      if (!hasTaxes) return sum;

      // Check if this is a baked good (viennoiserie or pâtisserie)
      const cat = categoryText(product);
      const isViennoiserie = cat.includes("viennoiser");
      const isPatisserie =
        (product as any)?.productionType === "patisserie" || cat.includes("patisser");
      const isBakedGood = isViennoiserie || isPatisserie;

      // Baked goods are tax-exempt when 6+ of them are ordered (any mix)
      if (isBakedGood && bakedGoodsExempt) return sum;

      return sum + item.amount;
    }, 0);
    const taxAmount = taxableSubtotal * TAX_RATE;
    const total = subtotal + taxAmount + formData.deliveryFee;
    const depositAmount = total;
    const balance = total - depositAmount;

    setFormData((prev) => ({
      ...prev,
      subtotal,
      taxAmount,
      total,
      depositAmount,
      balance,
    }));

    if (
      formData.deliveryType === "delivery" &&
      deliveryZoneInfo?.isValid &&
      subtotal > 0
    ) {
      if (subtotal < deliveryZoneInfo.minimumOrder) {
        const shortfall = deliveryZoneInfo.minimumOrder - subtotal;
        setMinimumOrderError(
          `Minimum de commande de ${deliveryZoneInfo.minimumOrder.toFixed(2)}$ requis pour ${formData.deliveryAddress?.postalCode}. Il manque ${shortfall.toFixed(2)}$.`,
        );
      } else {
        setMinimumOrderError("");
      }
    } else {
      setMinimumOrderError("");
    }
  }, [
    formData.items,
    formData.deliveryFee,
    formData.paymentMethod,
    deliveryZoneInfo,
    formData.deliveryType,
    products,
  ]);

  const handleInputChange = (field: keyof OrderFormData, value: any) => {
    setFormData((prev) => {
      const updated = { ...prev, [field]: value };

      if (field === "deliveryType") {
        if (value === "pickup") {
          updated.deliveryAddress = undefined;
          updated.deliveryFee = 0;
          setSelectedAddressId(null);
        }
      }

      return updated;
    });

    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }

    if (field === "deliveryType") {
      setErrors((prev) => {
        const newErrors = { ...prev };
        if (value === "pickup") {
          delete newErrors.deliveryAddress;
          delete newErrors.deliveryCity;
          delete newErrors.deliveryProvince;
          delete newErrors.deliveryPostalCode;
        } else if (value === "delivery") {
          delete newErrors.pickupLocation;
        }
        return newErrors;
      });
    }
  };

  const handleItemChange = (
    id: string,
    field: keyof OrderFormItem,
    value: any,
  ) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id === id) {
          const updatedItem = { ...item, [field]: value };
          if (field === "quantity" || field === "unitPrice") {
            updatedItem.amount = updatedItem.quantity * updatedItem.unitPrice;
          }
          return updatedItem;
        }
        return item;
      }),
    }));
  };

  const handlePackItem = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === id ? { ...item, isPacked: true } : item,
      ),
    }));
  };

  const handleClearProduct = (itemId: string) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          productId: null,
          productName: "",
          quantity: 1,
          unitPrice: 0,
          amount: 0,
          taxable: item.isCustom ? (item.taxable ?? true) : undefined,
          selectedOptions: undefined,
          isPacked: false,
        };
      }),
    }));
  };

  const getProductCategories = (product: Product): string[] => {
    if (Array.isArray((product as any).category)) {
      return (product as any).category
        .map((c: unknown) => String(c || "").trim())
        .filter(Boolean);
    }

    const singleCategory = String((product as any).category || "").trim();
    return singleCategory ? [singleCategory] : [];
  };

  const posCategories = useMemo(() => {
    const categoryCounter = new Map<string, number>();

    products
      .filter((p) => p.available)
      .forEach((product) => {
        const cats = getProductCategories(product);
        cats.forEach((category) => {
          categoryCounter.set(category, (categoryCounter.get(category) || 0) + 1);
        });
      });

    return Array.from(categoryCounter.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "fr", { sensitivity: "base" }))
      .map(([name, count]) => ({ name, count }));
  }, [products]);

  const posProducts = useMemo(() => {
    return products.filter((product) => {
      if (!product.available) return false;
      if (activePosCategory === "all") return true;
      return getProductCategories(product).includes(activePosCategory);
    });
  }, [products, activePosCategory]);

  const addProductFromPos = (product: Product) => {
    // Products with custom options always get a new line (different options = different item)
    const hasCustomOptions = product.customOptions && product.customOptions.length > 0;

    if (!hasCustomOptions) {
      const existing = formData.items.find(
        (item) => !item.isCustom && item.productId === product.id,
      );

      if (existing) {
        const maxQuantity = product.maxOrderQuantity || Number.MAX_SAFE_INTEGER;
        const nextQuantity = Math.min(existing.quantity + 1, maxQuantity);
        handleItemChange(existing.id, "quantity", nextQuantity);
        return;
      }
    }

    const initialOptions: Record<string, string> = {};
    for (const option of product.customOptions || []) {
      if (option.type === "text") {
        initialOptions[option.name] = "";
      } else {
        initialOptions[option.name] = option.choices?.[0] || "";
      }
    }

    const initialUnitPrice = calculatePriceWithOptions(
      product.price,
      product.customOptions || [],
      initialOptions,
    );
    const initialQuantity = Math.max(product.minOrderQuantity || 1, 1);

    const newItem: OrderFormItem = {
      id: Date.now().toString(),
      productId: product.id,
      productName: product.name,
      quantity: initialQuantity,
      unitPrice: initialUnitPrice,
      amount: initialUnitPrice * initialQuantity,
      taxable: undefined,
      notes: "",
      selectedOptions: initialOptions,
      isPacked: false,
      isCustom: false,
    };

    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, newItem],
    }));
  };

  const getProductById = (productId: number | null): Product | null => {
    if (!productId) return null;
    return products.find((p) => p.id === productId) || null;
  };

  function validatePreparationTime(
    orderDate: string,
    productId: number,
    pickupTime?: string,
  ) {
    const product = products.find((p) => p.id === productId);
    if (!product || !product.preparationTimeHours) return true;

    const orderDateTime = new Date(`${orderDate}T${pickupTime || "00:00"}:00`);
    const now = new Date();
    const timeDiff = orderDateTime.getTime() - now.getTime();
    const hoursDiff = timeDiff / (1000 * 60 * 60);

    return hoursDiff >= product.preparationTimeHours;
  }

  // Read "now" through the bakery's clock (America/Montreal), like Checkout
  // and the backend. Without this, an admin in another TZ would compute a
  // bogus minimum date and disagree with the backend on what's valid.
  function getMontrealNow() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Montreal",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) =>
      parseInt(parts.find((p) => p.type === t)?.value || "0", 10);
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
    };
  }

  // Displayed to staff/customers as 14h00, real gate sits at 14h15 (15-min
  // margin so a customer who hesitated at 14h01 doesn't get bounced). Same
  // value lives in Checkout.tsx and the backend createOrder validation.
  const CUTOFF_MINUTES = 14 * 60 + 15;

  /**
   * Earliest pickup date the admin can pick for the current cart.
   * - max-prep across items → that many full days of lead time
   * - past 14h15 Montréal → +1 extra day
   * Returns "YYYY-MM-DD" (Montréal calendar).
   */
  function getMinimumPickupDateStr(): string {
    const maxPrepHours = formData.items.reduce((max, item) => {
      if (item.isCustom) return max;
      const p = products.find((pp) => pp.id === item.productId);
      const h = p?.preparationTimeHours || 0;
      return h > max ? h : max;
    }, 0);
    const prepDays = Math.ceil(maxPrepHours / 24);

    const m = getMontrealNow();
    const cutoffPenalty = m.hour * 60 + m.minute >= CUTOFF_MINUTES ? 1 : 0;

    // Build a Date that represents Montréal's today at noon (avoids DST/TZ
    // wobble), then add the lead-time days.
    const d = new Date(Date.UTC(m.year, m.month - 1, m.day, 12, 0, 0));
    d.setUTCDate(d.getUTCDate() + prepDays + cutoffPenalty);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  // Edit-mode: don't punish the admin for an order whose date is already in
  // the past. We only enforce the cutoff for genuinely new orders.
  const isEditing = !!initialData;
  const minPickupDateStr = isEditing ? undefined : getMinimumPickupDateStr();

  function getPreparationTimeWarning(productId: number) {
    const product = products.find((p) => p.id === productId);
    if (!product || !product.preparationTimeHours) return null;

    if (product.preparationTimeHours >= 24) {
      return `Ce produit nécessite ${product.preparationTimeHours / 24} jour${product.preparationTimeHours / 24 > 1 ? "s" : ""} de préparation.`;
    } else if (product.preparationTimeHours >= 12) {
      return `Ce produit nécessite ${product.preparationTimeHours} heures de préparation.`;
    } else {
      return `Ce produit nécessite ${product.preparationTimeHours} heure${product.preparationTimeHours > 1 ? "s" : ""} de préparation.`;
    }
  };

  const addCustomItem = () => {
    const newItem: OrderFormItem = {
      id: Date.now().toString(),
      productId: null,
      productName: "",
      quantity: 1,
      unitPrice: 0,
      amount: 0,
      taxable: true,
      notes: "",
      isPacked: false,
      isCustom: true,
      customDescription: "",
    };
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, newItem],
    }));
  };

  // Delivery/pickup time slots — matches the public Checkout page so admins
  // pick from the same options customers see.
  const TIME_SLOTS = React.useMemo(
    () =>
      getAvailableTimeSlots(
        formData.date,
        formData.deliveryType,
        formData.pickupLocation,
      ),
    [formData.date, formData.deliveryType, formData.pickupLocation],
  );

  const removeItem = (id: string) => {
    // Used to require length > 1, which made the last item impossible to
    // delete — admin had to add a dummy product just to remove the original.
    // The form validation already catches "no item at submit", so we can
    // safely let the cart go empty.
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== id),
    }));
  };

  const handleOptionChange = (itemId: string, optionName: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== itemId) return item;

        const selectedOptions = {
          ...(item.selectedOptions || {}),
          [optionName]: value,
        };

        const product = getProductById(item.productId);
        if (!product) {
          return {
            ...item,
            selectedOptions,
          };
        }

        const unitPrice = calculatePriceWithOptions(
          product.price,
          product.customOptions || [],
          selectedOptions,
        );

        return {
          ...item,
          selectedOptions,
          unitPrice,
          amount: unitPrice * item.quantity,
        };
      }),
    }));
  };

  const getSerializedItemNotes = (item: OrderFormItem) => {
    const lines: string[] = [];

    if (item.notes && item.notes.trim().length > 0) {
      lines.push(`Note client: ${item.notes.trim()}`);
    }

    if (item.isCustom) {
      if (item.customDescription && item.customDescription.trim().length > 0) {
        lines.push(`Description: ${item.customDescription.trim()}`);
      }
    } else {
      const optionEntries = Object.entries(item.selectedOptions || {}).filter(
        ([, value]) => value && value.trim().length > 0,
      );
      if (optionEntries.length > 0) {
        lines.push(
          `Options: ${optionEntries.map(([key, value]) => `${key}: ${value}`).join(" | ")}`,
        );
      }
    }

    return lines.join("\n");
  }

  const normalizePhone = (value: string) => value.replace(/\D/g, "");

  const filteredClients = clients.filter((client) => {
    const query = emailSearch.trim().toLowerCase();
    if (!query) return true;

    const fullName = `${client.firstName} ${client.lastName}`.toLowerCase();
    const email = (client.email || "").toLowerCase();
    const phoneRaw = (client.phone || "").toLowerCase();
    const phoneDigits = normalizePhone(client.phone || "");
    const queryDigits = normalizePhone(query);

    return (
      fullName.includes(query) ||
      email.includes(query) ||
      phoneRaw.includes(query) ||
      (queryDigits.length > 0 && phoneDigits.includes(queryDigits))
    );
  });

  const handleClientSelect = (client: Client) => {
    setSelectedClient(client);
    const clientBillingKind = (client as any).billing?.kind as
      | "standard"
      | "representant"
      | "gouvernement"
      | undefined;
    setFormData((prev) => ({
      ...prev,
      clientId: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      phone: client.phone,
      // Inherit billing kind from the selected client so government flow works correctly
      billingKind: clientBillingKind || prev.billingKind || "standard",
      // Pre-fill the invoice (billing) email from the client's saved value.
      billingEmail: (client as any).billing?.invoiceEmail || prev.billingEmail || "",
      // Force paymentMethod to in_store for government clients (no Square link)
      paymentMethod:
        clientBillingKind === "gouvernement" ? "in_store" : prev.paymentMethod,
    }));
    setEmailSearch(client.email);
    setEmailOpen(false);
    setSelectedAddressId(null);
    setSelectedBillingAddressId(null);
  };

  const handleEmailChange = (value: string) => {
    setEmailSearch(value);
    setFormData((prev) => ({ ...prev, email: value }));

    if (selectedClient && value !== selectedClient.email) {
      setSelectedClient(null);
      setFormData((prev) => ({ ...prev, clientId: undefined }));
    }
  };

  const handleAddressSelect = (addressId: number) => {
    if (!selectedClient) return;

    const address = selectedClient.addresses.find(
      (addr) => addr.id === addressId,
    );
    if (address) {
      setSelectedAddressId(addressId);
      setFormData((prev) => ({
        ...prev,
        deliveryAddress: {
          street: address.street,
          city: address.city,
          province: address.province,
          postalCode: address.postalCode,
        },
      }));
    }
  };

  const handleBillingAddressSelect = (addressId: number) => {
    if (!selectedClient) return;

    const address = selectedClient.addresses.find(
      (addr) => addr.id === addressId,
    );
    if (address) {
      setSelectedBillingAddressId(addressId);
      setFormData((prev) => ({
        ...prev,
        billingAddress: {
          street: address.street,
          city: address.city,
          province: address.province,
          postalCode: address.postalCode,
          sameAsDelivery: false,
        },
      }));
    }
  };

  const copyDeliveryToBilling = () => {
    if (formData.deliveryAddress) {
      setFormData((prev) => ({
        ...prev,
        billingAddress: {
          ...prev.deliveryAddress!,
          sameAsDelivery: true,
        },
      }));
      setSelectedBillingAddressId(null);
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = "Le prénom est requis";
    }
    if (!formData.lastName.trim()) {
      newErrors.lastName = "Le nom de famille est requis";
    }
    // Phone only required when actually needed: sending the Square payment
    // link via SMS. Otherwise we let it be empty (self-signup clients on the
    // public site don't always have one).
    const phoneNeededForSms =
      formData.paymentMethod === "payment_link" &&
      formData.paymentLinkChannel === "sms";
    if (phoneNeededForSms && !formData.phone.trim()) {
      newErrors.phone =
        "Le téléphone est requis pour envoyer le lien de paiement par SMS";
    }
    if (!formData.email.trim()) {
      newErrors.email = "L'email est requis";
    }
    if (!formData.date) {
      newErrors.date = "La date est requise";
    } else if (!isEditing && minPickupDateStr && formData.date < minPickupDateStr) {
      // Same gate the backend enforces: combine prep-time lead + 14h15 Montréal
      // cutoff. We surface 14h00 in the message so staff don't see two cutoffs.
      const past14 = getMontrealNow().hour * 60 + getMontrealNow().minute >= CUTOFF_MINUTES;
      const minLabel = new Date(`${minPickupDateStr}T12:00:00`).toLocaleDateString("fr-CA", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      newErrors.date = past14
        ? `Passé 14h00 — la commande doit être pour ${minLabel} au plus tôt.`
        : `Date trop tôt — minimum ${minLabel}.`;
    }
    if ((formData.deliveryType === "pickup" || formData.deliveryType === "delivery") && !formData.pickupTime) {
      newErrors.pickupTime =
        formData.deliveryType === "delivery"
          ? "L'heure de livraison est requise"
          : "L'heure de ramassage est requise";
    }
    if (
      (formData.deliveryType === "pickup" || formData.deliveryType === "delivery") &&
      formData.pickupTime &&
      // Accept single "HH:MM" (pickup) or "HH:MM - HH:MM" (delivery range)
      !/^([01]\d|2[0-3]):[0-5]\d(\s*-\s*([01]\d|2[0-3]):[0-5]\d)?$/.test(formData.pickupTime)
    ) {
      newErrors.pickupTime = "Format invalide (ex: 14:00 ou 08:00 - 09:00)";
    }

    if (formData.deliveryType === "pickup") {
      if (!formData.pickupLocation) {
        newErrors.pickupLocation = "Le lieu de ramassage est requis";
      }
    }

    if (formData.deliveryType === "delivery") {
      if (!formData.deliveryAddress?.street.trim()) {
        newErrors.deliveryAddress = "L'adresse de livraison est requise";
      }
      if (!formData.deliveryAddress?.city.trim()) {
        newErrors.deliveryCity = "La ville est requise";
      }
    }

    if (formData.deliveryType === "delivery" && !formData.billingAddress?.sameAsDelivery) {
      if (!formData.billingAddress?.street.trim()) {
        newErrors.billingAddress = "L'adresse de facturation est requise";
      }
      if (!formData.billingAddress?.city.trim()) {
        newErrors.billingCity = "La ville de facturation est requise";
      }
      if (!formData.billingAddress?.postalCode.trim()) {
        newErrors.billingPostalCode = "Le code postal de facturation est requis";
      }
    }

    const hasValidItem = formData.items.some(
      (item) => (item.productId || item.isCustom) && item.quantity > 0,
    );
    if (!hasValidItem) {
      newErrors.items = "Au moins un article est requis";
    }

    formData.items.forEach((item, index) => {
      if (item.isCustom) {
        if (!item.productName.trim()) {
          newErrors[`item_${index}_name`] = "Le nom est requis";
        }
        if (item.unitPrice <= 0) {
          newErrors[`item_${index}_price`] = "Le prix doit être supérieur à 0";
        }
      } else if (item.productId) {
        const product = getProductById(item.productId);
        if (product) {
          if (item.quantity < product.minOrderQuantity) {
            newErrors[`item_${index}_quantity`] =
              `Minimum ${product.minOrderQuantity}`;
          }
          if (item.quantity > product.maxOrderQuantity) {
            newErrors[`item_${index}_quantity`] =
              `Maximum ${product.maxOrderQuantity}`;
          }
        }
      }
    });

    // Validation du délai de préparation (avertissement bloquant pour l'admin)
    formData.items.forEach((item, index) => {
      if (item.productId && !item.isCustom) {
        if (!validatePreparationTime(formData.date, item.productId, formData.pickupTime)) {
          const warning = getPreparationTimeWarning(item.productId);
          newErrors[`item_${index}_preparation`] =
            `⚠️ ${warning || "Délai de préparation insuffisant pour la date sélectionnée."}`;
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      const payloadItems = formData.items.map((item) => ({
        ...item,
        productId: item.isCustom ? 0 : item.productId,
        taxable: item.isCustom ? item.taxable !== false : undefined,
        notes: getSerializedItemNotes(item),
      }));
      onSubmit({ ...formData, items: payloadItems });
    }
  };

  return (
    <form id="order-form" onSubmit={handleSubmit} className="space-y-6">
      {/* SECTION 1: En-tête avec DATE SEULEMENT (plus de filtres !) */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-200">
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-3">
          <div className="w-48">
            <Label htmlFor="date" className="text-xs text-gray-600">
              DATE:
            </Label>
            <Input
              id="date"
              type="date"
              value={formData.date}
              min={minPickupDateStr}
              onChange={(e) => handleInputChange("date", e.target.value)}
              className={errors.date ? "border-red-500" : ""}
            />
            {errors.date && (
              <p className="text-xs text-red-500 mt-1">{errors.date}</p>
            )}
            {!isEditing && minPickupDateStr && (
              <p className="text-[10px] text-gray-500 mt-1">
                Minimum : {new Date(`${minPickupDateStr}T12:00:00`).toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" })}
                {getMontrealNow().hour * 60 + getMontrealNow().minute >= CUTOFF_MINUTES
                  ? " (commandes pour demain à passer avant 14h00)"
                  : ""}
              </p>
            )}
          </div>

          {(formData.deliveryType === "pickup" || formData.deliveryType === "delivery") && (
            <div className={formData.deliveryType === "delivery" ? "w-56" : "w-40"}>
              <Label htmlFor="pickupTime" className="text-xs text-gray-600">
                {formData.deliveryType === "delivery" ? "HEURE LIVRAISON:" : "HEURE RAMASSAGE:"}
              </Label>
              <Select
                value={formData.pickupTime || undefined}
                onValueChange={(value) => handleInputChange("pickupTime", value)}
                disabled={!formData.date || TIME_SLOTS.length === 0}
              >
                <SelectTrigger
                  id="pickupTime"
                  className={errors.pickupTime ? "border-red-500" : ""}
                >
                  <SelectValue
                    placeholder={
                      !formData.date
                        ? "Choisir une date d'abord"
                        : "Choisir une heure"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {/* Preserve any legacy / out-of-grid value loaded from initialData */}
                  {formData.pickupTime &&
                    !TIME_SLOTS.includes(formData.pickupTime) && (
                      <SelectItem value={formData.pickupTime}>
                        {formData.pickupTime} (existant)
                      </SelectItem>
                    )}
                  {TIME_SLOTS.map((slot) => (
                    <SelectItem key={slot} value={slot}>
                      {slot}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.pickupTime && (
                <p className="text-xs text-red-500 mt-1">{errors.pickupTime}</p>
              )}
            </div>
          )}
          </div>

          {preparationWarnings.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              <div className="text-xs font-semibold">
                ⚠ Délai de préparation insuffisant pour la date/heure choisie
              </div>
              <ul className="mt-1 text-xs list-disc pl-5 space-y-0.5">
                {preparationWarnings.slice(0, 4).map((w) => (
                  <li key={w.itemId}>{w.label}</li>
                ))}
              </ul>
              {preparationWarnings.length > 4 && (
                <div className="mt-1 text-xs">
                  +{preparationWarnings.length - 4} autre(s) article(s)…
                </div>
              )}
            </div>
          )}
        </div>

        {onViewProducts && (
          <Button
            type="button"
            onClick={onViewProducts}
            variant="outline"
            className="flex items-center gap-2 text-[#C5A065] border-[#C5A065] hover:bg-[#C5A065] hover:text-white"
          >
            <Package className="w-4 h-4" />
            Voir les produits
          </Button>
        )}
      </div>

      {/* SECTION 2: Informations client */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-gray-200">
        <div>
          <Label htmlFor="email" className="text-xs text-gray-600">
            EMAIL:
          </Label>
          <Popover open={emailOpen && !selectedClient} onOpenChange={(o) => !selectedClient && setEmailOpen(o)}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={emailOpen}
                disabled={!!selectedClient}
                className={`w-full justify-start text-left font-normal ${
                  errors.email ? "border-red-500" : ""
                } ${selectedClient ? "bg-gray-50 text-gray-600 cursor-not-allowed opacity-100" : ""}`}
              >
                {emailSearch || "Rechercher un client..."}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0" align="start">
              <Command>
                <CommandInput
                  placeholder="Rechercher par nom, telephone ou email..."
                  value={emailSearch}
                  onValueChange={handleEmailChange}
                />
                <CommandList>
                  <CommandEmpty>Aucun client trouvé</CommandEmpty>
                  <CommandGroup>
                    {filteredClients.map((client) => (
                      <CommandItem
                        key={client.id}
                        value={`${client.firstName} ${client.lastName} ${client.email} ${client.phone}`}
                        onSelect={() => handleClientSelect(client)}
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {client.firstName} {client.lastName}
                          </span>
                          <span className="text-xs text-gray-500">
                            {client.email} - {client.phone}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {errors.email && (
            <p className="text-xs text-red-500 mt-1">{errors.email}</p>
          )}
        </div>

        <div>
          <Label htmlFor="firstName" className="text-xs text-gray-600">
            PRÉNOM:
          </Label>
          <Input
            id="firstName"
            type="text"
            value={formData.firstName}
            onChange={(e) => handleInputChange("firstName", e.target.value)}
            readOnly={!!selectedClient}
            className={`${errors.firstName ? "border-red-500" : ""} ${selectedClient ? "bg-gray-50 text-gray-600 cursor-not-allowed" : ""}`}
            placeholder="Prénom"
          />
          {errors.firstName && (
            <p className="text-xs text-red-500 mt-1">{errors.firstName}</p>
          )}
        </div>

        <div>
          <Label htmlFor="lastName" className="text-xs text-gray-600">
            NOM DE FAMILLE:
          </Label>
          <Input
            id="lastName"
            type="text"
            value={formData.lastName}
            onChange={(e) => handleInputChange("lastName", e.target.value)}
            readOnly={!!selectedClient}
            className={`${errors.lastName ? "border-red-500" : ""} ${selectedClient ? "bg-gray-50 text-gray-600 cursor-not-allowed" : ""}`}
            placeholder="Nom de famille"
          />
          {errors.lastName && (
            <p className="text-xs text-red-500 mt-1">{errors.lastName}</p>
          )}
        </div>

        <div>
          <Label htmlFor="phone" className="text-xs text-gray-600">
            TÉL:
          </Label>
          <Input
            id="phone"
            type="tel"
            value={formData.phone}
            onChange={(e) => handleInputChange("phone", e.target.value)}
            readOnly={!!selectedClient}
            className={`${errors.phone ? "border-red-500" : ""} ${selectedClient ? "bg-gray-50 text-gray-600 cursor-not-allowed" : ""}`}
            placeholder="(___) ___-____"
          />
          {errors.phone && (
            <p className="text-xs text-red-500 mt-1">{errors.phone}</p>
          )}
        </div>

        <div className="col-span-2">
          {selectedClient && (
            <div className="text-xs bg-green-50 text-green-700 p-2 rounded-md flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                Client existant verrouillé: {selectedClient.firstName}{" "}
                {selectedClient.lastName}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-green-800 hover:bg-green-100"
                onClick={() => {
                  setSelectedClient(null);
                  setEmailSearch("");
                  setFormData((prev) => ({
                    ...prev,
                    clientId: undefined,
                    firstName: "",
                    lastName: "",
                    email: "",
                    phone: "",
                  }));
                }}
              >
                Changer de client
              </Button>
            </div>
          )}
          {!selectedClient && emailSearch && (
            <div className="text-xs bg-blue-50 text-blue-700 p-2 rounded-md">
              Nouveau client
            </div>
          )}
          {!selectedClient && emailSearch && (
            <div className="space-y-2 pt-2">
              <Label className="text-xs text-gray-600">TYPE DE CLIENT</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {([
                  { value: "standard", label: "Standard" },
                  { value: "representant", label: "Représentant" },
                  { value: "gouvernement", label: "Gouvernement" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleInputChange("billingKind", opt.value)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      formData.billingKind === opt.value
                        ? "bg-[#C5A065] text-white border-[#C5A065]"
                        : "bg-white text-stone-600 border-stone-200 hover:border-stone-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {formData.billingKind === "representant" && (
                <p className="text-[11px] text-amber-600">Paiement au jour de ramassage</p>
              )}
              {formData.billingKind === "gouvernement" && (
                <p className="text-[11px] text-blue-600">Paiement dans 6 mois</p>
              )}
              {formData.billingKind === "gouvernement" && (
                <div className="mt-2 space-y-1">
                  <label className="text-[11px] font-semibold text-gray-700">
                    Courriel de facturation (ville) — reçoit la facture
                  </label>
                  <input
                    type="email"
                    value={formData.billingEmail || ""}
                    onChange={(e) => handleInputChange("billingEmail", e.target.value)}
                    className="w-full p-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#337957]/40"
                    placeholder="comptes@ville.ca"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 3: Type de commande */}
      <div className="pb-4 border-b border-gray-200">
        <div className="mb-4">
          <Label className="text-xs text-gray-600 mb-2">TYPE:</Label>
          <RadioGroup
            value={formData.deliveryType}
            onValueChange={(value) => handleInputChange("deliveryType", value)}
            className="flex gap-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="pickup" id="pickup" />
              <Label htmlFor="pickup" className="text-sm font-normal">
                Ramassage
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="delivery" id="delivery" />
              <Label htmlFor="delivery" className="text-sm font-normal">
                Livraison
              </Label>
            </div>
          </RadioGroup>
        </div>

        {formData.deliveryType === "pickup" && (
          <div>
            <Label className="text-xs text-gray-600 mb-2">
              LIEU DE RAMASSAGE:
            </Label>
            <RadioGroup
              value={formData.pickupLocation}
              onValueChange={(value) =>
                handleInputChange("pickupLocation", value)
              }
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Laval" id="laval" />
                <Label htmlFor="laval" className="text-sm font-normal">
                  Laval
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Montreal" id="montreal" />
                <Label htmlFor="montreal" className="text-sm font-normal">
                  Montréal
                </Label>
              </div>
            </RadioGroup>
            {errors.pickupLocation && (
              <p className="text-xs text-red-500 mt-1">
                {errors.pickupLocation}
              </p>
            )}
          </div>
        )}
      </div>

      {/* SECTION 4: Adresse de livraison */}
      {formData.deliveryType === "delivery" && (
        <div className="space-y-4 pb-4 border-b border-gray-200">
          <Label className="text-xs text-gray-600">ADRESSE DE LIVRAISON:</Label>

          {selectedClient && selectedClient.addresses.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-gray-500">
                Adresses enregistrées:
              </Label>
              <RadioGroup
                value={selectedAddressId?.toString()}
                onValueChange={(value) => handleAddressSelect(parseInt(value))}
                className="space-y-2"
              >
                {selectedClient.addresses.map((address) => (
                  <div key={address.id} className="flex items-start space-x-2">
                    <RadioGroupItem
                      value={address.id.toString()}
                      id={`address-${address.id}`}
                    />
                    <Label
                      htmlFor={`address-${address.id}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      <div>
                        <div>{address.street}</div>
                        <div className="text-xs text-gray-500">
                          {address.city}, {address.province}{" "}
                          {address.postalCode}
                        </div>
                      </div>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <div className="text-xs text-gray-500 mt-2">
                Ou entrez une nouvelle adresse:
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="street" className="text-xs text-gray-600">
                RUE:
              </Label>
              <Input
                id="street"
                type="text"
                value={formData.deliveryAddress?.street || ""}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    deliveryAddress: {
                      ...prev.deliveryAddress,
                      street: e.target.value,
                      city: prev.deliveryAddress?.city || "",
                      province: prev.deliveryAddress?.province || "",
                      postalCode: prev.deliveryAddress?.postalCode || "",
                    },
                  }))
                }
                className={errors.deliveryAddress ? "border-red-500" : ""}
                placeholder="123 Rue Example"
              />
              {errors.deliveryAddress && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.deliveryAddress}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="city" className="text-xs text-gray-600">
                VILLE:
              </Label>
              <Input
                id="city"
                type="text"
                value={formData.deliveryAddress?.city || ""}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    deliveryAddress: {
                      ...prev.deliveryAddress,
                      street: prev.deliveryAddress?.street || "",
                      city: e.target.value,
                      province: prev.deliveryAddress?.province || "",
                      postalCode: prev.deliveryAddress?.postalCode || "",
                    },
                  }))
                }
                className={errors.deliveryCity ? "border-red-500" : ""}
                placeholder="Montréal"
              />
              {errors.deliveryCity && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.deliveryCity}
                </p>
              )}
            </div>

            <div className="relative">
              <Label
                htmlFor="deliveryPostalCode"
                className="text-xs text-gray-600"
              >
                CODE POSTAL:
              </Label>
              <Input
                id="deliveryPostalCode"
                type="text"
                value={formData.deliveryAddress?.postalCode || ""}
                onFocus={() => setDeliveryPostalOpen(true)}
                onBlur={() => setTimeout(() => setDeliveryPostalOpen(false), 150)}
                onChange={(e) => {
                  const postalCode = e.target.value.toUpperCase();
                  const zoneInfo = calculateDeliveryFee(postalCode);
                  if (zoneInfo.isValid) {
                    setDeliveryZoneInfo({
                      zoneName: zoneInfo.zoneName,
                      fee: zoneInfo.fee,
                      minimumOrder: zoneInfo.minimumOrder,
                      isValid: true,
                    });
                  } else {
                    setDeliveryZoneInfo(null);
                  }
                  setFormData((prev) => ({
                    ...prev,
                    deliveryAddress: {
                      ...prev.deliveryAddress,
                      street: prev.deliveryAddress?.street || "",
                      city: prev.deliveryAddress?.city || "",
                      province: prev.deliveryAddress?.province || "QC",
                      postalCode,
                    },
                    deliveryFee: zoneInfo.isValid ? zoneInfo.fee : 0,
                  }));
                  setDeliveryPostalOpen(true);
                }}
                className={errors.deliveryPostalCode ? "border-red-500" : ""}
                placeholder="H1A 1A1"
                autoComplete="off"
              />
              {deliveryPostalOpen && (formData.deliveryAddress?.postalCode || "").length >= 1 && (
                (() => {
                  const q = (formData.deliveryAddress?.postalCode || "").toUpperCase();
                  const matches = DELIVERY_ZONES.flatMap((zone) =>
                    zone.postalCodes
                      .filter((pc) => pc.startsWith(q))
                      .map((pc) => ({ pc, zone })),
                  );
                  if (matches.length === 0) return null;
                  return (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-stone-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {matches.map(({ pc, zone }) => (
                        <button
                          key={`${zone.name}-${pc}`}
                          type="button"
                          className="w-full text-left px-4 py-2 text-sm hover:bg-stone-50"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const zoneInfo = calculateDeliveryFee(pc);
                            setDeliveryZoneInfo(
                              zoneInfo.isValid
                                ? {
                                    zoneName: zoneInfo.zoneName,
                                    fee: zoneInfo.fee,
                                    minimumOrder: zoneInfo.minimumOrder,
                                    isValid: true,
                                  }
                                : null,
                            );
                            setFormData((prev) => ({
                              ...prev,
                              deliveryAddress: {
                                ...prev.deliveryAddress,
                                street: prev.deliveryAddress?.street || "",
                                city: prev.deliveryAddress?.city || "",
                                province: prev.deliveryAddress?.province || "QC",
                                postalCode: pc,
                              },
                              deliveryFee: zoneInfo.isValid ? zoneInfo.fee : 0,
                            }));
                            setDeliveryPostalOpen(false);
                          }}
                        >
                          <span className="font-semibold">{pc}</span>{" "}
                          <span className="text-xs text-stone-500">
                            — {zone.deliveryFee.toFixed(2)}$ (min.{" "}
                            {zone.minimumOrder.toFixed(2)}$)
                          </span>
                        </button>
                      ))}
                    </div>
                  );
                })()
              )}
              {errors.deliveryPostalCode && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.deliveryPostalCode}
                </p>
              )}
              {deliveryZoneInfo && (
                <div
                  className={`text-xs mt-1 p-2 rounded ${
                    deliveryZoneInfo.isValid
                      ? "bg-green-50 text-green-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  {deliveryZoneInfo.isValid ? (
                    <>
                      <div className="font-semibold">
                        Zone: {deliveryZoneInfo.zoneName}
                      </div>
                      <div>
                        Frais de livraison: {deliveryZoneInfo.fee.toFixed(2)}$
                      </div>
                      <div>
                        Minimum requis:{" "}
                        {deliveryZoneInfo.minimumOrder.toFixed(2)}$
                      </div>
                    </>
                  ) : (
                    <div>Code postal invalide</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 5: Adresse de facturation */}
      {formData.deliveryType === "delivery" && (
      <div className="space-y-4 pb-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-bold text-gray-700 uppercase">
            ADRESSE DE FACTURATION:
          </Label>
          {formData.deliveryAddress && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={copyDeliveryToBilling}
              className="text-xs text-[#C5A065] hover:text-[#B38F55]"
            >
              <Check className="w-3 h-3 mr-1" />
              Identique à la livraison
            </Button>
          )}
        </div>

        {formData.deliveryAddress && (
          <div className="flex items-center space-x-2 mb-2">
            <input
              type="checkbox"
              id="sameAsDelivery"
              checked={formData.billingAddress?.sameAsDelivery || false}
              onChange={(e) => {
                if (e.target.checked) {
                  copyDeliveryToBilling();
                } else {
                  setFormData((prev) => ({
                    ...prev,
                    billingAddress: {
                      street: "",
                      city: "",
                      province: "",
                      postalCode: "",
                      sameAsDelivery: false,
                    },
                  }));
                }
              }}
              className="rounded border-gray-300 text-[#C5A065] focus:ring-[#C5A065]"
            />
            <Label htmlFor="sameAsDelivery" className="text-sm font-normal">
              Identique à l'adresse de livraison
            </Label>
          </div>
        )}

        {selectedClient &&
          selectedClient.addresses.length > 0 &&
          !formData.billingAddress?.sameAsDelivery && (
            <div className="space-y-2">
              <Label className="text-xs text-gray-500">
                Adresses de facturation enregistrées:
              </Label>
              <RadioGroup
                value={selectedBillingAddressId?.toString()}
                onValueChange={(value) =>
                  handleBillingAddressSelect(parseInt(value))
                }
                className="space-y-2"
              >
                {selectedClient.addresses.map((address) => (
                  <div
                    key={`billing-${address.id}`}
                    className="flex items-start space-x-2"
                  >
                    <RadioGroupItem
                      value={address.id.toString()}
                      id={`billing-address-${address.id}`}
                    />
                    <Label
                      htmlFor={`billing-address-${address.id}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      <div>
                        <div>{address.street}</div>
                        <div className="text-xs text-gray-500">
                          {address.city}, {address.province}{" "}
                          {address.postalCode}
                        </div>
                      </div>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <div className="text-xs text-gray-500 mt-2">
                Ou entrez une nouvelle adresse de facturation:
              </div>
            </div>
          )}

        {!formData.billingAddress?.sameAsDelivery && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="billingStreet" className="text-xs text-gray-600">
                RUE:
              </Label>
              <Input
                id="billingStreet"
                type="text"
                value={formData.billingAddress?.street || ""}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    billingAddress: {
                      ...prev.billingAddress,
                      street: e.target.value,
                      city: prev.billingAddress?.city || "",
                      province: prev.billingAddress?.province || "",
                      postalCode: prev.billingAddress?.postalCode || "",
                      sameAsDelivery: false,
                    },
                  }))
                }
                className={errors.billingAddress ? "border-red-500" : ""}
                placeholder="123 Rue Example"
              />
              {errors.billingAddress && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.billingAddress}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="billingCity" className="text-xs text-gray-600">
                VILLE:
              </Label>
              <Input
                id="billingCity"
                type="text"
                value={formData.billingAddress?.city || ""}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    billingAddress: {
                      ...prev.billingAddress,
                      street: prev.billingAddress?.street || "",
                      city: e.target.value,
                      province: prev.billingAddress?.province || "",
                      postalCode: prev.billingAddress?.postalCode || "",
                      sameAsDelivery: false,
                    },
                  }))
                }
                className={errors.billingCity ? "border-red-500" : ""}
                placeholder="Montréal"
              />
              {errors.billingCity && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.billingCity}
                </p>
              )}
            </div>

            <div className="relative">
              <Label
                htmlFor="billingPostalCode"
                className="text-xs text-gray-600"
              >
                CODE POSTAL:
              </Label>
              <Input
                id="billingPostalCode"
                type="text"
                value={formData.billingAddress?.postalCode || ""}
                onFocus={() => setBillingPostalOpen(true)}
                onBlur={() => setTimeout(() => setBillingPostalOpen(false), 150)}
                onChange={(e) => {
                  const pc = e.target.value.toUpperCase();
                  setFormData((prev) => ({
                    ...prev,
                    billingAddress: {
                      ...prev.billingAddress,
                      street: prev.billingAddress?.street || "",
                      city: prev.billingAddress?.city || "",
                      province: prev.billingAddress?.province || "QC",
                      postalCode: pc,
                      sameAsDelivery: false,
                    },
                  }));
                  setBillingPostalOpen(true);
                }}
                className={errors.billingPostalCode ? "border-red-500" : ""}
                placeholder="H1A 1A1"
                autoComplete="off"
              />
              {billingPostalOpen && (formData.billingAddress?.postalCode || "").length >= 1 && (
                (() => {
                  const q = (formData.billingAddress?.postalCode || "").toUpperCase();
                  const matches = DELIVERY_ZONES.flatMap((zone) =>
                    zone.postalCodes
                      .filter((pc) => pc.startsWith(q))
                      .map((pc) => ({ pc, zone })),
                  );
                  if (matches.length === 0) return null;
                  return (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-stone-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {matches.map(({ pc, zone }) => (
                        <button
                          key={`billing-${zone.name}-${pc}`}
                          type="button"
                          className="w-full text-left px-4 py-2 text-sm hover:bg-stone-50"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setFormData((prev) => ({
                              ...prev,
                              billingAddress: {
                                ...prev.billingAddress,
                                street: prev.billingAddress?.street || "",
                                city: prev.billingAddress?.city || "",
                                province: prev.billingAddress?.province || "QC",
                                postalCode: pc,
                                sameAsDelivery: false,
                              },
                            }));
                            setBillingPostalOpen(false);
                          }}
                        >
                          <span className="font-semibold">{pc}</span>{" "}
                          <span className="text-xs text-stone-500">— {zone.name}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()
              )}
              {errors.billingPostalCode && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.billingPostalCode}
                </p>
              )}
            </div>
          </div>
        )}

        {formData.billingAddress?.sameAsDelivery && formData.deliveryAddress && (
          <div className="bg-green-50 p-3 rounded-lg border border-green-100">
            <div className="flex items-start gap-2">
              <Check className="w-4 h-4 text-green-600 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-green-800">
                  Adresse de facturation identique à l'adresse de livraison
                </p>
                <p className="text-xs text-green-700 mt-1">
                  {formData.deliveryAddress.street}, {formData.deliveryAddress.city},{" "}
                  {formData.deliveryAddress.province}{" "}
                  {formData.deliveryAddress.postalCode}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* SECTION 6: Articles */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs text-gray-600">ARTICLES:</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={addCustomItem}
              variant="ghost"
              size="sm"
              className="text-xs text-purple-600 hover:text-purple-700"
            >
              <Plus className="w-4 h-4" />
              Item personnalisé
            </Button>
          </div>
        </div>

        {/* Indicateur de commande prête */}
        {errors.items && (
          <p className="text-xs text-red-500 mb-2">{errors.items}</p>
        )}

        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
          <div className="text-xs font-semibold text-gray-700 uppercase">Sélection rapide (style POS)</div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={activePosCategory === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setActivePosCategory("all")}
              className="h-8 text-xs"
            >
              Toutes ({products.filter((p) => p.available).length})
            </Button>
            {posCategories.map((cat) => (
              <Button
                key={cat.name}
                type="button"
                variant={activePosCategory === cat.name ? "default" : "outline"}
                size="sm"
                onClick={() => setActivePosCategory(cat.name)}
                className="h-8 text-xs"
              >
                {cat.name} ({cat.count})
              </Button>
            ))}
          </div>

          {productsLoading ? (
            <p className="text-xs text-gray-500">Chargement des produits...</p>
          ) : posProducts.length === 0 ? (
            <p className="text-xs text-gray-500">Aucun produit disponible dans cette catégorie.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2 max-h-64 overflow-y-auto pr-1">
              {posProducts.map((product) => {
                const selectedItem = formData.items.find(
                  (item) => !item.isCustom && item.productId === product.id,
                );

                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addProductFromPos(product)}
                    className={`rounded-md border bg-white overflow-hidden text-left hover:border-amber-400 hover:shadow-sm transition ${
                      selectedItem ? "border-green-400 ring-1 ring-green-300" : "border-gray-200"
                    }`}
                  >
                    <div className="h-20 bg-gray-100">
                      {product.image ? (
                        <img
                          src={getImageUrl(product.image)}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">
                          Sans image
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-[11px] font-semibold text-gray-900 line-clamp-2 min-h-[30px]">
                        {product.name}
                      </div>
                      <div className="mt-1 text-[11px] text-gray-600">{product.price.toFixed(2)} $</div>
                      {selectedItem && (
                        <div className="mt-1 text-[10px] font-semibold text-green-700">
                          Dans la commande: x{selectedItem.quantity}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border border-gray-300 rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">PRODUIT</TableHead>
                <TableHead className="w-24 text-xs">QTÉ</TableHead>
                <TableHead className="w-28 text-xs">PRIX</TableHead>
                <TableHead className="w-28 text-xs">MONTANT</TableHead>
                <TableHead className="w-24"></TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {formData.items.map((item, index) => {
                const product = item.productId
                  ? getProductById(item.productId)
                  : null;
                const quantityError = errors[`item_${index}_quantity`];
                const preparationError = errors[`item_${index}_preparation`];
                const nameError = errors[`item_${index}_name`];
                const priceError = errors[`item_${index}_price`];
                // Avertissement délai de préparation en temps réel
                const livePreparationWarning =
                  !item.isCustom && item.productId && formData.date
                    ? !validatePreparationTime(formData.date, item.productId, formData.pickupTime)
                      ? getPreparationTimeWarning(item.productId) || "Délai de préparation insuffisant pour la date sélectionnée."
                      : null
                    : null;

                return (
                  <React.Fragment key={item.id}>
                    <TableRow className={`align-top ${item.isCustom ? "bg-purple-50" : ""}`}>
                      <TableCell className="align-top pt-3">
                        {item.isCustom ? (
                          <div className="space-y-1">
                            <div className="text-[10px] font-semibold text-purple-700 uppercase mb-1">Item personnalisé</div>
                            <Input
                              type="text"
                              placeholder="Nom de l'item..."
                              value={item.productName}
                              onChange={(e) => handleItemChange(item.id, "productName", e.target.value)}
                              className={`h-7 text-sm ${nameError ? "border-red-500" : ""}`}
                            />
                            {nameError && <p className="text-xs text-red-500">{nameError}</p>}
                            <Input
                              type="text"
                              placeholder="Description (optionnel)..."
                              value={item.customDescription || ""}
                              onChange={(e) => handleItemChange(item.id, "customDescription", e.target.value)}
                              className="h-7 text-xs"
                            />
                            <label className="flex items-center gap-2 text-xs text-purple-800 pt-1">
                              <Checkbox
                                checked={item.taxable !== false}
                                onCheckedChange={(checked) =>
                                  handleItemChange(item.id, "taxable", checked !== false)
                                }
                              />
                              Taxable
                            </label>
                          </div>
                        ) : (
                        <div className="space-y-1">
                          {item.productId && product && (
                            <>
                              <div className="flex items-center justify-between gap-2 rounded-md border border-green-200 bg-green-50 px-2 py-1">
                                <div className="min-w-0 flex items-center gap-2">
                                  <div className="text-[9px] font-semibold text-green-700 uppercase shrink-0">
                                    Produit
                                  </div>
                                  <div className="truncate text-sm font-semibold text-gray-900">
                                    {product.name}
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[11px] text-green-800 hover:text-green-900 hover:bg-green-100 shrink-0"
                                  onClick={() => handleClearProduct(item.id)}
                                >
                                  Changer
                                </Button>
                              </div>
                              {/* Inline dropdowns below the product banner */}
                              {product.customOptions && product.customOptions.some(
                                (opt) =>
                                  opt.type !== "text" &&
                                  !isAllergyOptionName(opt.name) &&
                                  !isClientNoteOptionName(opt.name),
                              ) && (
                                <div className="flex items-center flex-wrap gap-3 px-2">
                                  {product.customOptions
                                    .filter(
                                      (opt) =>
                                        opt.type !== "text" &&
                                        !isAllergyOptionName(opt.name) &&
                                        !isClientNoteOptionName(opt.name),
                                    )
                                    .map((option) => (
                                      <div
                                        key={`inline-${item.id}-${option.name}`}
                                        className="flex items-center gap-1.5"
                                      >
                                        <span className="text-[11px] font-medium text-gray-600">
                                          {option.name}:
                                        </span>
                                        <Select
                                          value={item.selectedOptions?.[option.name] || ""}
                                          onValueChange={(value) =>
                                            handleOptionChange(item.id, option.name, value)
                                          }
                                        >
                                          <SelectTrigger className="h-6 text-xs w-auto min-w-[90px] px-2">
                                            <SelectValue placeholder="Choisir" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {option.choices.map((choice) => (
                                              <SelectItem key={choice} value={choice}>
                                                {choice}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    ))}
                                </div>
                              )}
                            </>
                          )}
                          {!item.productId && (
                            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                              Sélectionnez un produit dans la grille ci-dessus
                            </div>
                          )}
                          {(livePreparationWarning || preparationError) && (
                            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                              ⚠️ {livePreparationWarning || preparationError}
                            </div>
                          )}
                        </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top pt-3">
                        <Input
                          // type="text" + inputMode="numeric" instead of
                          // type="number": the latter ignores select() on
                          // mobile Safari/Chrome and breaks the tablet flow
                          // where Fanny taps "3" expecting to replace the "1"
                          // but ends up with "13".
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={
                            Number(item.quantity) > 0
                              ? String(Number(item.quantity))
                              : ""
                          }
                          // Wipe the field on focus so the very next digit
                          // typed becomes the whole quantity. No backspace,
                          // no "13" when she meant "3". If she taps away
                          // without typing anything, onBlur restores 1.
                          onFocus={(e) => {
                            const t = e.currentTarget;
                            // setTimeout(0) lets the mobile keyboard's tap
                            // handler finish positioning the caret first,
                            // then we wipe.
                            setTimeout(() => {
                              t.value = "";
                              handleItemChange(item.id, "quantity", 0);
                            }, 0);
                          }}
                          onBlur={() => {
                            // If she leaves an empty/zero qty, snap back to 1
                            // so the cart never has a 0-qty line silently.
                            if (!Number(item.quantity)) {
                              handleItemChange(item.id, "quantity", 1);
                            }
                          }}
                          onChange={(e) => {
                            // Strip everything except digits so a stray space
                            // or letter doesn't crash parseInt.
                            const raw = e.target.value.replace(/[^0-9]/g, "");
                            const next = raw === "" ? 0 : parseInt(raw, 10);
                            handleItemChange(
                              item.id,
                              "quantity",
                              Number.isFinite(next) && next >= 0 ? next : 0,
                            );
                          }}
                          disabled={!item.productId && !item.isCustom}
                          className={`h-8 text-sm ${quantityError ? "border-red-500" : ""}`}
                        />
                        {quantityError && (
                          <p className="text-xs text-red-500 mt-1">
                            {quantityError}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top pt-3">
                        {item.isCustom ? (
                          <div>
                            <Input
                              type="number"
                              min={0}
                              step={0.01}
                              value={item.unitPrice}
                              onChange={(e) =>
                                handleItemChange(
                                  item.id,
                                  "unitPrice",
                                  parseFloat(e.target.value) || 0,
                                )
                              }
                              className={`h-8 text-sm w-24 ${priceError ? "border-red-500" : ""}`}
                            />
                            {priceError && <p className="text-xs text-red-500 mt-1">{priceError}</p>}
                          </div>
                        ) : (
                          <div className="text-sm font-medium text-gray-700">
                            ${item.unitPrice.toFixed(2)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top pt-3">
                        <div className="text-sm font-medium text-gray-700">
                          ${item.amount.toFixed(2)}
                        </div>
                      </TableCell>
                      <TableCell className="align-top pt-3">
                        {/* Bouton Emballer */}
                        {false && item.productId && !item.isPacked && (
                          <Button
                            type="button"
                            onClick={() => handlePackItem(item.id)}
                            size="sm"
                            className="h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                          >
                            Emballer
                          </Button>
                        )}
                        {false && item.isPacked && (
                          <span className="inline-flex items-center px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">
                            <Check className="w-3 h-3 mr-1" />
                            Emballé
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top pt-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setExpandedNoteItemIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                return next;
                              })
                            }
                            className={`h-8 w-8 ${
                              expandedNoteItemIds.has(item.id) || item.notes
                                ? "text-amber-600 hover:text-amber-700"
                                : "text-gray-400 hover:text-gray-600"
                            }`}
                            title="Ajouter une note"
                          >
                            <StickyNote className="w-4 h-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(item.id)}
                            className="h-8 w-8 text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {(item.productId || item.isCustom) && (() => {
                      const noteOptions = (product?.customOptions || []).filter(
                        (option) =>
                          option.type === "text" ||
                          isAllergyOptionName(option.name) ||
                          isClientNoteOptionName(option.name),
                      );
                      const hasSavedNoteValue = noteOptions.some((o) =>
                        String(item.selectedOptions?.[o.name] || "").trim().length > 0,
                      );
                      const showNoteRow =
                        noteOptions.length > 0 &&
                        (expandedNoteItemIds.has(item.id) || hasSavedNoteValue);
                      if (!showNoteRow) return null;
                      return (
                      <TableRow className={item.isCustom ? "bg-purple-50" : ""}>
                        <TableCell colSpan={6} className="bg-gray-50 py-2">
                          <div className="space-y-3">
                            {noteOptions.length > 0 && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {noteOptions.map((option) => (
                                  <div key={`${item.id}-${option.name}`}>
                                    {option.type === "text" &&
                                    (isAllergyOptionName(option.name) ||
                                      isClientNoteOptionName(option.name)) ? (
                                      <div className="flex items-center gap-2">
                                        <Label className="text-[11px] text-gray-600 shrink-0 min-w-[70px]">
                                          {option.name}
                                        </Label>
                                        <Input
                                          value={item.selectedOptions?.[option.name] || ""}
                                          onChange={(e) =>
                                            handleOptionChange(
                                              item.id,
                                              option.name,
                                              e.target.value,
                                            )
                                          }
                                          placeholder={`Écrire ${option.name.toLowerCase()}...`}
                                          className="h-7 text-xs flex-1"
                                        />
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        <Label className="text-[11px] text-gray-600 shrink-0 min-w-[70px]">
                                          {option.name}
                                        </Label>
                                        {option.type === "text" ? (
                                          <Input
                                            value={
                                              item.selectedOptions?.[option.name] || ""
                                            }
                                            onChange={(e) =>
                                              handleOptionChange(
                                                item.id,
                                                option.name,
                                                e.target.value,
                                              )
                                            }
                                            placeholder={`Entrer ${option.name.toLowerCase()}...`}
                                            className="h-7 text-xs flex-1"
                                          />
                                        ) : (
                                          <Select
                                            value={
                                              item.selectedOptions?.[option.name] || ""
                                            }
                                            onValueChange={(value) =>
                                              handleOptionChange(
                                                item.id,
                                                option.name,
                                                value,
                                              )
                                            }
                                          >
                                            <SelectTrigger className="h-7 text-xs flex-1">
                                              <SelectValue placeholder="Choisir" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {option.choices.map((choice) => (
                                                <SelectItem key={choice} value={choice}>
                                                  {choice}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })()}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {errors.items && (
          <p className="text-xs text-red-500 mt-2">{errors.items}</p>
        )}
      </div>

      {minimumOrderError && (
        <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
          ⚠️ {minimumOrderError}
        </div>
      )}

      {/* SECTION 7.5: Méthode de paiement */}
      <div className="space-y-3 pb-4 border-b border-gray-200">
        <Label className="text-xs font-bold text-gray-700 uppercase">
          MÉTHODE DE PAIEMENT:
        </Label>
        {formData.billingKind === "gouvernement" ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            <p className="font-semibold mb-1">Client gouvernemental</p>
            <p className="text-xs">
              Aucun lien de paiement ne sera envoyé. La facture sera envoyée par courriel et le paiement se fera par chèque ou virement.
            </p>
          </div>
        ) : (
        <RadioGroup
          value={formData.paymentMethod}
          onValueChange={(value) => handleInputChange("paymentMethod", value)}
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <div className="flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:border-[#C5A065] transition-colors">
            <RadioGroupItem value="in_store" id="in_store" />
            <Label htmlFor="in_store" className="cursor-pointer text-sm">
              Payer en magasin
            </Label>
          </div>
          <div className="flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:border-[#C5A065] transition-colors">
            <RadioGroupItem value="payment_link" id="payment_link" />
            <Label htmlFor="payment_link" className="cursor-pointer text-sm">
              Envoyer lien de paiement
            </Label>
          </div>
        </RadioGroup>
        )}

        {formData.billingKind !== "gouvernement" && formData.paymentMethod === "payment_link" && (
          <div className="space-y-2 pt-1">
            <Label className="text-xs text-gray-600">ENVOI DU LIEN:</Label>
            <RadioGroup
              value={formData.paymentLinkChannel}
              onValueChange={(value) =>
                handleInputChange("paymentLinkChannel", value)
              }
              className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            >
              <div className="flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:border-[#C5A065] transition-colors">
                <RadioGroupItem value="email" id="link_email" />
                <Label htmlFor="link_email" className="cursor-pointer text-sm">
                  Par courriel
                </Label>
              </div>
              <div className="flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:border-[#C5A065] transition-colors">
                <RadioGroupItem value="sms" id="link_sms" />
                <Label htmlFor="link_sms" className="cursor-pointer text-sm">
                  Par telephone (SMS)
                </Label>
              </div>
            </RadioGroup>
          </div>
        )}
      </div>

      {/* SECTION 7.6: Note client visible sur la confirmation */}
      <div className="space-y-2 pb-4 border-b border-gray-200">
        <Label className="text-xs font-bold text-gray-700 uppercase">
          NOTE POUR LE CLIENT (visible sur la confirmation):
        </Label>
        <textarea
          value={formData.notes || ""}
          onChange={(e) => handleInputChange("notes", e.target.value)}
          placeholder="Ex: Préparez la commande au comptoir B..."
          rows={3}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none resize-y"
        />
      </div>

      {/* SECTION 8: Totaux */}
      <div className="border-t border-gray-200 pt-4">
        <div className="ml-auto space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">SOUS-TOTAL:</span>
            <span className="font-medium">${formData.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">TPS + TVQ (14.975%):</span>
            <span className="font-medium">
              ${formData.taxAmount.toFixed(2)}
            </span>
          </div>
          {formData.deliveryType === "delivery" && (
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">LIVRAISON:</span>
              <span className="font-medium">
                ${formData.deliveryFee.toFixed(2)}
              </span>
            </div>
          )}
          <div className="flex justify-between items-center text-base font-semibold border-t border-gray-300 pt-2">
            <span className="text-gray-800">TOTAL:</span>
            <span className="text-amber-600">${formData.total.toFixed(2)}</span>
          </div>
          {editPaymentAdjustment && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-blue-800 font-semibold">DIFFERENCE COMMANDE:</span>
                <span
                  className={`font-bold ${
                    editPaymentAdjustment.totalDifference > 0
                      ? "text-red-700"
                      : editPaymentAdjustment.totalDifference < 0
                        ? "text-green-700"
                        : "text-blue-800"
                  }`}
                >
                  {editPaymentAdjustment.totalDifference > 0 ? "+" : ""}
                  ${editPaymentAdjustment.totalDifference.toFixed(2)}
                </span>
              </div>
              <div className="mt-1 text-xs text-blue-900">
                {editPaymentAdjustment.outstandingDifference > 0.01
                  ? `Montant a ajouter: ${editPaymentAdjustment.outstandingDifference.toFixed(2)}$`
                  : editPaymentAdjustment.outstandingDifference < -0.01
                    ? `Montant a rembourser / avoir: ${Math.abs(editPaymentAdjustment.outstandingDifference).toFixed(2)}$`
                    : "Aucun ajustement de paiement requis"}
              </div>
            </div>
          )}
          <div className="flex justify-between items-center text-sm bg-amber-50 p-2 rounded">
            <span className="text-gray-700">
              {formData.paymentMethod === "in_store"
                ? "PAYABLE MAINTENANT (100%):"
                : "PAIEMENT TOTAL (100%):"}
            </span>
            <span className="font-medium text-amber-700">
              ${formData.depositAmount.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">BALANCE:</span>
            <span className="font-medium">${formData.balance.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </form>
  );
}
