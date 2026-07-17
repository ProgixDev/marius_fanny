import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  X,
  Plus,
  Minus,
  ShoppingBag,
  CreditCard,
  MapPin,
  AlertCircle,
  User,
  ShoppingCart,
  Tag,
  Check,
} from "lucide-react";
import {
  calculateDeliveryFee,
  DELIVERY_ZONES,
} from "../utils/deliveryZones";
import { authClient } from "../lib/AuthClient";
import { getSessionUniversal } from "../utils/getSession";
import { promoAPI } from "../lib/PromoAPI";
import { itemTaxRates } from "../data";
import { getImageUrl } from "../utils/api";

interface CartItem {
  id: number;
  name: string;
  price: number;
  image: string;
  quantity: number;
  cartItemKey?: string;
  selectedOptions?: Record<string, string>;
  hasTaxes?: boolean;
  taxMode?: "both" | "gst_only" | "none";
  category?: string;
  productionType?: string;
  availableDays?: number[];
  preparationTimeHours?: number;
  minOrderQuantity?: number;
}

interface CartProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  onUpdateQuantity: (cartItemKey: string, delta: number) => void;
  onRemove: (cartItemKey: string) => void;
}

const CartDrawer: React.FC<CartProps> = ({
  isOpen,
  onClose,
  items,
  onUpdateQuantity,
  onRemove,
}) => {
  const navigate = useNavigate();
  const [selectedPostalCode, setSelectedPostalCode] = useState<string>("");
  const [showPostalSuggestions, setShowPostalSuggestions] = useState(false);
  const postalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (postalRef.current && !postalRef.current.contains(e.target as Node)) {
        setShowPostalSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const [deliveryType, setDeliveryType] = useState<"pickup" | "delivery">(
    "pickup",
  );
  const [isProUser, setIsProUser] = useState(false);
  const [proDistanceTier, setProDistanceTier] = useState<"lt20" | "gt20">("lt20");
  const [pickupLocation, setPickupLocation] = useState<"Montreal" | "Laval">(
    "Laval",
  );
  const [deliveryZoneInfo, setDeliveryZoneInfo] = useState<{
    fee: number;
    minimumOrder: number;
    zoneName: string;
    isValid: boolean;
  } | null>(null);
  
  // État pour le modal de choix de connexion
  const [showLoginChoiceModal, setShowLoginChoiceModal] = useState(false);
  const [orderData, setOrderData] = useState<any>(null);
  const [inStoreConfirmation, setInStoreConfirmation] = useState<{
    orderId: string;
    timestamp: string;
    total: number;
    itemsCount: number;
  } | null>(null);

  // Code promo
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    discountPercent: number;
    discountAmount: number;
    appliesToProductIds: number[] | null;
  } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);

  const PROMO_CODES: Record<string, { label: string; type: "percent" | "fixed"; value: number }> = {
    "BIENVENUE10": { label: "Bienvenue -10%",  type: "percent", value: 10  },
    "FIDELITE15":  { label: "Fidélité -15%",   type: "percent", value: 15  },
    "ETE2026":     { label: "Été 2026 -5$",    type: "fixed",   value: 5   },
    "VIP20":       { label: "VIP -20%",        type: "percent", value: 20  },
  };

  const handleApplyPromo = async () => {
    const code = promoInput.trim();
    if (!code) return;
    setIsApplyingPromo(true);
    setPromoError(null);
    
    // Get user email for promo code validation
    let userEmail: string | undefined;
    try {
      const session = await getSessionUniversal();
      userEmail = session?.user?.email;
    } catch (e) {
      // Not logged in, that's ok
    }
    
    const promo = await promoAPI.validatePromo({
      code,
      subtotal,
      email: userEmail,
      items: items.map((item) => ({
        productId: item.id,
        amount: item.price * item.quantity,
      })),
    }).catch((err: any) => {
      setAppliedPromo(null);
      setPromoError(err?.message || "Code promo invalide ou expiré.");
      return null;
    });
    if (promo?.data) {
      setAppliedPromo({
        code: promo.data.code,
        discountPercent: promo.data.discountPercent,
        discountAmount: promo.data.discountAmount,
        appliesToProductIds: promo.data.appliesToProductIds,
      });
      setPromoError(null);
      setPromoInput("");
      setIsApplyingPromo(false);
    } else {
      setIsApplyingPromo(false);
    }
  };

  const handleRemovePromo = () => {
    setAppliedPromo(null);
    setPromoError(null);
    setPromoInput("");
  };

  // Log cart open/close events
  useEffect(() => {
    if (isOpen) {
      console.log(`🛒 [FRONTEND] Cart opened with ${items.length} items`);
    } else {
      console.log(`🛒 [FRONTEND] Cart closed`);
    }
  }, [isOpen, items.length]);

  // Calculs
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  const categoryText = (item: any) => {
    const value = item?.category;
    if (Array.isArray(value)) return value.join(" ").toLowerCase();
    return String(value || "").toLowerCase();
  };

  const viennoiseriesCount = items.reduce((sum, item) => {
    const category = categoryText(item);
    return category.includes("viennoiser") ? sum + item.quantity : sum;
  }, 0);

  // Count pâtisseries via productionType (reliable) OR category fallback
  const patisseriesCount = items.reduce((sum, item) => {
    const isPatisserie =
      item.productionType === "patisserie" ||
      categoryText(item).includes("patisser");
    return isPatisserie ? sum + item.quantity : sum;
  }, 0);

  // Combined count: 6+ viennoiseries/pâtisseries (any mix) → all are tax-exempt
  const viennoiseriesAndPatisseriesCount = viennoiseriesCount + patisseriesCount;
  const bakedGoodsExempt = viennoiseriesAndPatisseriesCount >= 6;

  // TPS et TVQ calculées séparément (certains produits n'ont que la TPS).
  const taxSplit = items.reduce(
    (acc, item) => {
      const category = categoryText(item);
      const isViennoiserie = category.includes("viennoiser");
      const isPatisserie =
        item.productionType === "patisserie" || category.includes("patisser");
      const isBakedGood = isViennoiserie || isPatisserie;

      // Règle des 6 : viennoiseries/pâtisseries exonérées à 6 unités et plus.
      if (isBakedGood && bakedGoodsExempt) return acc;

      const rates = itemTaxRates(item);
      const base = item.price * item.quantity;
      acc.tps += base * rates.tps;
      acc.tvq += base * rates.tvq;
      return acc;
    },
    { tps: 0, tvq: 0 },
  );
  const tpsAmount = Math.round(taxSplit.tps * 100) / 100;
  const tvqAmount = Math.round(taxSplit.tvq * 100) / 100;
  const taxes = Math.round((tpsAmount + tvqAmount) * 100) / 100;

  const proDeliveryFee =
    deliveryType === "delivery" ? (proDistanceTier === "gt20" ? 30 : 15) : 0;

  const delivery = isProUser
    ? proDeliveryFee
    : deliveryType === "delivery" && deliveryZoneInfo?.isValid
      ? deliveryZoneInfo.fee
      : 0;

  const discount = appliedPromo ? Math.min(appliedPromo.discountAmount, subtotal) : 0;

  const total = subtotal - discount + taxes + delivery;

  // Validate minimum order
  const minimumOrderValidation =
    deliveryType === "delivery" && deliveryZoneInfo?.isValid
      ? {
          isValid: subtotal >= deliveryZoneInfo.minimumOrder,
          shortfall: Math.max(0, deliveryZoneInfo.minimumOrder - subtotal),
          postalCode: selectedPostalCode,
          minimumOrder: deliveryZoneInfo.minimumOrder,
        }
      : null;

  const proMinimumOrderValidation =
    isProUser && deliveryType === "delivery"
      ? {
          isValid: subtotal >= 150,
          shortfall: Math.max(0, 150 - subtotal),
          postalCode: selectedPostalCode,
          minimumOrder: 150,
        }
      : null;

  const effectiveMinimumOrderValidation = isProUser
    ? proMinimumOrderValidation
    : minimumOrderValidation;

  const handlePostalCodeChange = (postalCode: string) => {
    const normalized = (postalCode || "").toUpperCase();
    setSelectedPostalCode(normalized);

    if (!normalized || isProUser) {
      setDeliveryZoneInfo(null);
      return;
    }

    const zoneInfo = calculateDeliveryFee(normalized);
    setDeliveryZoneInfo(zoneInfo);
  };

  useEffect(() => {
    const loadRole = async () => {
      try {
        const session = await getSessionUniversal();
        const user: any = session?.user;
        const role = user?.role || user?.user_metadata?.role;
        setIsProUser(role === "pro");
      } catch {
        setIsProUser(false);
      }
    };
    loadRole();
  }, [isOpen]);

  useEffect(() => {
    if (isProUser) setDeliveryZoneInfo(null);
  }, [isProUser]);

  const handleProceedToPayment = async () => {
    console.log("🛒 [CART] handleProceedToPayment called", {
      deliveryType,
      pickupLocation,
      itemsCount: items.length,
    });
    
    if (deliveryType === "delivery" && selectedPostalCode.trim().length < 3) {
      alert("Veuillez sélectionner un code postal pour la livraison.");
      return;
    }

    if (effectiveMinimumOrderValidation && !effectiveMinimumOrderValidation.isValid) {
      alert(
        `Minimum de commande non atteint. Il manque ${effectiveMinimumOrderValidation.shortfall.toFixed(2)}$.`,
      );
      return;
    }

    // Stocker les informations de commande avant de proposer le choix
    const newOrderData = {
      items: items,
      postalCode: selectedPostalCode,
      deliveryType: deliveryType,
      proDeliveryDistanceTier:
        isProUser && deliveryType === "delivery" ? proDistanceTier : undefined,
      pickupLocation: deliveryType === "pickup" ? pickupLocation : undefined,
      deliveryFee: delivery,
      subtotal: subtotal,
      discount: discount,
      promoCode: appliedPromo?.code || undefined,
      taxes: taxes,
      total: total,
      timestamp: Date.now(),
    };

    // Sauvegarder les données de commande dans localStorage
    localStorage.setItem("checkout_data", JSON.stringify(newOrderData));
    
    // Stocker dans l'état et ouvrir le modal
    try {
      const session = await getSessionUniversal();
      if (session?.user) {
        navigate("/checkout", {
          state: {
            ...newOrderData,
            isGuest: false,
          },
        });
        onClose();
        return;
      }
    } catch {
      // ignore - fallback to login choice modal
    }

    setOrderData(newOrderData);
    setShowLoginChoiceModal(true);
  };

  const buildOptionsSignature = (options?: Record<string, string>) => {
    if (!options || Object.keys(options).length === 0) return "";
    return Object.entries(options)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join("|");
  };

  const getCartItemKey = (item: CartItem) =>
    item.cartItemKey || `${item.id}::${buildOptionsSignature(item.selectedOptions)}`;

  const handleInStorePayment = () => {
    if (!items.length) return;

    const timestamp = new Date();
    const orderId = `MAG-${timestamp.getFullYear()}${(timestamp.getMonth() + 1)
      .toString()
      .padStart(2, "0")}${timestamp
      .getDate()
      .toString()
      .padStart(2, "0")}-${timestamp
      .getTime()
      .toString()
      .slice(-5)}`;

    const slip = {
      orderId,
      timestamp: timestamp.toISOString(),
      items,
      deliveryType,
      pickupLocation:
        deliveryType === "pickup" ? pickupLocation : undefined,
      deliveryFee: delivery,
      subtotal,
      taxes,
      total,
    };

    const stored = JSON.parse(
      localStorage.getItem("in_store_orders") || "[]",
    );
    stored.push(slip);
    localStorage.setItem("in_store_orders", JSON.stringify(stored));

    setInStoreConfirmation({
      orderId,
      timestamp: slip.timestamp,
      total,
      itemsCount: items.length,
    });
  };

  const handleDownloadOrderSlip = () => {
    if (!inStoreConfirmation) return;

    const slipLines = [
      "Bon de commande - Paiement en magasin",
      `N° de commande : ${inStoreConfirmation.orderId}`,
      `Date : ${new Date(inStoreConfirmation.timestamp).toLocaleString()}`,
      `Articles : ${inStoreConfirmation.itemsCount}`,
      `Montant total : ${inStoreConfirmation.total.toFixed(2)} $`,
    ];

    const blob = new Blob([slipLines.join("\n")], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bon-de-commande-${inStoreConfirmation.orderId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoginChoice = (wantsToLogin: boolean) => {
    setShowLoginChoiceModal(false);
    
    if (wantsToLogin) {
      // L'utilisateur veut se connecter/créer un compte
      console.log("🔐 [CART] User wants to login, redirecting to login page");
      
      // Sauvegarder l'intention de checkout pour après la connexion
      localStorage.setItem(
        "checkout_intent",
        JSON.stringify({
          ...orderData,
          redirectAfterLogin: true
        })
      );
      
      onClose();
      navigate("/se-connecter", { 
        state: { 
          redirectTo: "/checkout",
          fromCart: true 
        } 
      });
    } else {
      // L'utilisateur veut continuer sans compte
      console.log("✅ [CART] User proceeds as guest");
      
      // Marquer dans le localStorage que c'est une commande invité
      localStorage.setItem("is_guest_checkout", "true");
      
      // Naviguer directement vers le checkout
      navigate("/checkout", {
        state: {
          ...orderData,
          isGuest: true
        },
      });
      
      onClose();
    }
  };

  return (
    <>
      {/* Modal de choix de connexion */}
      {showLoginChoiceModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl transform transition-all">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-serif text-[#2D2A26]">
                  Choisissez votre option
                </h3>
                <button
                  onClick={() => setShowLoginChoiceModal(false)}
                  className="p-2 hover:bg-stone-100 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <p className="text-stone-600 mb-6">
                Comment souhaitez-vous continuer ?
              </p>
              
              <div className="space-y-3">
                {/* Option Se connecter */}
                <button
                  onClick={() => handleLoginChoice(true)}
                  className="w-full p-4 bg-[#337957]/10 hover:bg-[#337957]/20 border-2 border-[#337957] rounded-xl transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-[#337957] rounded-full flex items-center justify-center text-white">
                      <User size={24} />
                    </div>
                    <div className="text-left flex-1">
                      <h4 className="font-bold text-[#2D2A26] group-hover:text-[#337957] transition-colors">
                        Se connecter / Créer un compte
                      </h4>
                      <p className="text-sm text-stone-500">
                        ✓ Suivi de commande • ✓ Historique d'achats • ✓ Paiement plus rapide
                      </p>
                    </div>
                  </div>
                </button>
                
                {/* Option Invité */}
                <button
                  onClick={() => handleLoginChoice(false)}
                  className="w-full p-4 bg-stone-50 hover:bg-stone-100 border-2 border-stone-200 rounded-xl transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-stone-400 rounded-full flex items-center justify-center text-white">
                      <ShoppingCart size={24} />
                    </div>
                    <div className="text-left flex-1">
                      <h4 className="font-bold text-[#2D2A26] group-hover:text-[#337957] transition-colors">
                        Continuer sans compte
                      </h4>
                      <p className="text-sm text-stone-500">
                        Paiement rapide sans création de compte
                      </p>
                    </div>
                  </div>
                </button>
              </div>
              
              <button
                onClick={() => setShowLoginChoiceModal(false)}
                className="w-full mt-4 py-3 text-stone-500 hover:text-stone-700 text-sm transition-colors"
              >
                Retour au panier
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay du panier */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-150 transition-opacity duration-500 ${isOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      {/* Panier */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-white z-200 shadow-2xl transform transition-transform duration-500 ease-out ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-stone-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShoppingBag className="text-[#337957]" size={24} />
              <h2 className="text-xl font-serif text-[#2D2A26]">
                Votre Sélection
              </h2>
              <span className="bg-[#337957]/10 text-[#337957] text-xs font-bold px-2 py-1 rounded-full">
                {items.length}
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-stone-100 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="grow overflow-y-auto p-6 space-y-6">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center text-stone-300">
                  <ShoppingBag size={40} />
                </div>
                <p className="text-stone-500 font-light italic">
                  Votre panier est encore vide...
                </p>
                <button
                  onClick={onClose}
                  className="text-[#337957] font-bold uppercase text-xs tracking-widest underline"
                >
                  Continuer mes achats
                </button>
              </div>
            ) : (
              items.map((item) => (
                <div key={getCartItemKey(item)} className="flex flex-col gap-3 group border border-stone-100 rounded-2xl p-3">
                  {/* Image Produit */}
                  <div className="w-full h-40 rounded-xl overflow-hidden bg-stone-100 border border-stone-100">
                    <img
                      src={getImageUrl(item.image)}
                      alt={item.name}
                      className="w-full h-full object-cover brightness-105 contrast-[1.03]"
                    />
                  </div>

                  {/* Infos Produit */}
                  <div className="grow">
                    <div className="flex justify-between mb-1">
                      <h3 className="font-serif text-[#2D2A26]">{item.name}</h3>
                      <button
                        onClick={() => onRemove(getCartItemKey(item))}
                        className="text-stone-300 hover:text-red-400 transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    {item.selectedOptions &&
                      Object.keys(item.selectedOptions).length > 0 && (
                        <div className="mb-2 space-y-1">
                          {Object.entries(item.selectedOptions)
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([label, value]) => (
                              <p key={`${item.id}-${label}`} className="text-[11px] text-stone-500 leading-tight">
                                {label}: <span className="font-medium text-stone-700">{value}</span>
                              </p>
                            ))}
                        </div>
                      )}
                    <p className="text-[#337957] font-bold mb-3">
                      {item.price.toFixed(2)} $
                    </p>

                    {/* Contrôle Quantité */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center border border-stone-200 rounded-lg">
                        <button
                          onClick={() => onUpdateQuantity(getCartItemKey(item), -1)}
                          className="p-1 px-2 hover:bg-stone-50"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="px-3 py-1 text-sm font-medium">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => onUpdateQuantity(getCartItemKey(item), 1)}
                          className="p-1 px-2 hover:bg-stone-50"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <span className="text-sm font-bold text-[#337957]">
                        {(item.price * item.quantity).toFixed(2)} $
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}

            {/* Delivery Type Selection */}
            {items.length > 0 && (
              <div className="bg-white p-4 rounded-lg border border-stone-200">
                <label className="flex items-center gap-2 text-sm font-medium text-[#2D2A26] mb-3">
                  <ShoppingBag size={16} className="text-[#337957]" />
                  Mode de récupération:
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDeliveryType("pickup")}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      deliveryType === "pickup"
                        ? "bg-[#337957] text-white border-[#337957]"
                        : "bg-white text-[#2D2A26] border-stone-300 hover:border-[#337957]"
                    }`}
                  >
                    Ramassage
                  </button>
                  <button
                    onClick={() => setDeliveryType("delivery")}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      deliveryType === "delivery"
                        ? "bg-[#337957] text-white border-[#337957]"
                        : "bg-white text-[#2D2A26] border-stone-300 hover:border-[#337957]"
                    }`}
                  >
                    Livraison
                  </button>
                </div>
              </div>
            )}

            {/* Pickup Location Selection */}
            {items.length > 0 && deliveryType === "pickup" && (
              <div className="bg-white p-4 rounded-lg border border-stone-200">
                <label className="flex items-center gap-2 text-sm font-medium text-[#2D2A26] mb-3">
                  <MapPin size={16} className="text-[#337957]" />
                  Lieu de ramassage:
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setPickupLocation("Laval")}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      pickupLocation === "Laval"
                        ? "bg-[#337957] text-white border-[#337957]"
                        : "bg-white text-[#2D2A26] border-stone-300 hover:border-[#337957]"
                    }`}
                  >
                    Laval
                  </button>
                  <button
                    onClick={() => setPickupLocation("Montreal")}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      pickupLocation === "Montreal"
                        ? "bg-[#337957] text-white border-[#337957]"
                        : "bg-white text-[#2D2A26] border-stone-300 hover:border-[#337957]"
                    }`}
                  >
                    Montréal
                  </button>
                </div>
              </div>
            )}

            {/* Postal Code Input */}
            {items.length > 0 && deliveryType === "delivery" && (
              <div className="bg-white p-4 rounded-lg border border-stone-200">
                <label className="flex items-center gap-2 text-sm font-medium text-[#2D2A26] mb-2">
                  <MapPin size={16} className="text-[#337957]" />
                  Code Postal pour Livraison:
                </label>
                {isProUser ? (
                  <>
                    <input
                      value={selectedPostalCode}
                      onChange={(e) => handlePostalCodeChange(e.target.value)}
                      placeholder="Code postal (ex: H7X 1A1)"
                      className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm focus:outline-none focus:border-[#337957] focus:ring-1 focus:ring-[#337957]/30"
                    />

                    <div className="mt-3">
                      <div className="text-xs font-semibold text-stone-600 mb-2">
                        Distance (frais pro)
                      </div>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setProDistanceTier("lt20")}
                          className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                            proDistanceTier === "lt20"
                              ? "bg-[#337957] text-white border-[#337957]"
                              : "bg-white text-[#2D2A26] border-stone-300 hover:border-[#337957]"
                          }`}
                        >
                          &lt; 20 km (15$)
                        </button>
                        <button
                          type="button"
                          onClick={() => setProDistanceTier("gt20")}
                          className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                            proDistanceTier === "gt20"
                              ? "bg-[#337957] text-white border-[#337957]"
                              : "bg-white text-[#2D2A26] border-stone-300 hover:border-[#337957]"
                          }`}
                        >
                          &gt; 20 km (30$)
                        </button>
                      </div>

                      <div className="mt-2 p-2 rounded text-xs bg-blue-50 text-blue-700">
                        Frais pro: {proDeliveryFee.toFixed(2)}$ | Minimum livraison pro: 150$
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="relative" ref={postalRef}>
                      <input
                        type="text"
                        value={selectedPostalCode}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 3);
                          setSelectedPostalCode(val);
                          if (val.length >= 2) {
                            setShowPostalSuggestions(true);
                          }
                          if (val.length === 3) {
                            handlePostalCodeChange(val);
                          } else {
                            // Reset delivery info if incomplete
                            setDeliveryZoneInfo(null);
                          }
                        }}
                        onFocus={() => {
                          if (selectedPostalCode.length >= 2) setShowPostalSuggestions(true);
                        }}
                        placeholder="Entrez les 3 premières lettres (ex: H7X)"
                        className="w-full px-4 py-3 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#337957]/50"
                        maxLength={3}
                      />
                      {showPostalSuggestions && selectedPostalCode.length >= 2 && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-stone-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {DELIVERY_ZONES.flatMap((zone) =>
                            zone.postalCodes
                              .filter((pc) => pc.startsWith(selectedPostalCode))
                              .map((pc) => (
                                <button
                                  key={`${zone.name}-${pc}`}
                                  type="button"
                                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-stone-50 transition-colors ${
                                    selectedPostalCode === pc ? "bg-[#337957]/10 text-[#337957] font-semibold" : "text-stone-700"
                                  }`}
                                  onClick={() => {
                                    handlePostalCodeChange(pc);
                                    setShowPostalSuggestions(false);
                                  }}
                                >
                                  {pc} ({zone.deliveryFee.toFixed(2)}$ livraison, min. {zone.minimumOrder.toFixed(2)}$)
                                </button>
                              ))
                          )}
                          {DELIVERY_ZONES.flatMap((zone) =>
                            zone.postalCodes.filter((pc) => pc.startsWith(selectedPostalCode))
                          ).length === 0 && (
                            <div className="px-4 py-3 text-sm text-stone-400">Aucun code postal trouvé</div>
                          )}
                        </div>
                      )}
                    </div>
                {deliveryZoneInfo && (
                  <div
                    className={`mt-2 p-2 rounded text-xs ${
                      deliveryZoneInfo.isValid
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-700"
                    }`}
                  >
                    {deliveryZoneInfo.isValid ? (
                      <>
                        <div className="font-semibold">
                          ✓ {selectedPostalCode}
                        </div>
                        <div>
                          Frais: {deliveryZoneInfo.fee.toFixed(2)}$ | Minimum:{" "}
                          {deliveryZoneInfo.minimumOrder.toFixed(2)}$
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-1">
                        <AlertCircle size={14} />
                        Code postal non trouvé
                      </div>
                    )}
                  </div>
                )}
                  </>
                )}
                {effectiveMinimumOrderValidation &&
                  !effectiveMinimumOrderValidation.isValid && (
                  <div className="mt-2 p-2 rounded text-xs bg-amber-50 text-amber-700 flex items-start gap-1">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <div>
                      Minimum de commande non atteint. Il manque{" "}
                      {effectiveMinimumOrderValidation.shortfall.toFixed(2)}$.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Totals and Payment */}
            {items.length > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-stone-500 font-light">
                  <span>Sous-total</span>
                  <span>{subtotal.toFixed(2)} $</span>
                </div>

                {/* Code promo */}
                {!appliedPromo ? (
                  <div className="pt-1">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                        <input
                          type="text"
                          value={promoInput}
                          onChange={(e) => { setPromoInput(e.target.value); setPromoError(null); }}
                          onKeyDown={(e) => e.key === "Enter" && handleApplyPromo()}
                          placeholder="Code promo"
                          className="w-full pl-8 pr-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:border-[#337957] focus:ring-1 focus:ring-[#337957]/30 bg-white"
                        />
                      </div>
                      <button
                        onClick={handleApplyPromo}
                        disabled={!promoInput.trim() || isApplyingPromo}
                        className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#2D2A26] text-white hover:bg-[#337957] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isApplyingPromo ? "..." : "Appliquer"}
                      </button>
                    </div>
                    {promoError && (
                      <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
                        <AlertCircle size={12} />{promoError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between py-1.5 px-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Check size={14} className="text-emerald-600" />
                      <span className="text-sm font-semibold text-emerald-700">{appliedPromo.code}</span>
                      <span className="text-xs text-emerald-600">-{appliedPromo.discountPercent}%</span>
                    </div>
                    <button onClick={handleRemovePromo} className="text-emerald-500 hover:text-red-500 transition-colors ml-2">
                      <X size={14} />
                    </button>
                  </div>
                )}

                {discount > 0 && (
                  <div className="flex justify-between text-sm font-medium text-emerald-600">
                    <span>Réduction ({appliedPromo?.code})</span>
                    <span>- {discount.toFixed(2)} $</span>
                  </div>
                )}

                {tpsAmount > 0 && (
                  <div className="flex justify-between text-sm text-stone-500 font-light">
                    <span>TPS (5 %)</span>
                    <span>{tpsAmount.toFixed(2)} $</span>
                  </div>
                )}
                {tvqAmount > 0 && (
                  <div className="flex justify-between text-sm text-stone-500 font-light">
                    <span>TVQ (9,975 %)</span>
                    <span>{tvqAmount.toFixed(2)} $</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-stone-500 font-light">
                  <span>Frais de livraison</span>
                  <span>
                    {delivery === 0
                      ? selectedPostalCode
                        ? "Code postal requis"
                        : "Sélectionnez code postal"
                      : `${delivery.toFixed(2)} $`}
                  </span>
                </div>
                <div className="flex justify-between text-xl font-serif text-[#2D2A26] pt-2">
                  <span>Total</span>
                  <span className="text-[#337957]">{total.toFixed(2)} $</span>
                </div>
              </div>
            )}

            {/* Payment Section */}
            {items.length > 0 && (
              <>
                <button
                  onClick={handleProceedToPayment}
                  disabled={
                    (deliveryType === "delivery" &&
                      ((isProUser
                        ? selectedPostalCode.trim().length < 3
                        : !deliveryZoneInfo?.isValid) ||
                        (effectiveMinimumOrderValidation !== null &&
                          !effectiveMinimumOrderValidation?.isValid)))
                  }
                  className={`w-full py-4 rounded-xl font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-3 transition-all shadow-lg mt-4 group ${
                    (deliveryType === "delivery" &&
                      ((isProUser
                        ? selectedPostalCode.trim().length < 3
                        : !deliveryZoneInfo?.isValid) ||
                        (effectiveMinimumOrderValidation !== null &&
                          !effectiveMinimumOrderValidation?.isValid)))
                      ? "bg-stone-400 text-stone-600 cursor-not-allowed"
                      : "bg-[#2D2A26] text-white hover:bg-[#337957]"
                  }`}
                  title={
                    deliveryType === "delivery" &&
                    (isProUser
                      ? selectedPostalCode.trim().length < 3
                      : !deliveryZoneInfo?.isValid)
                      ? "Veuillez entrer un code postal valide"
                      : deliveryType === "delivery" &&
                          effectiveMinimumOrderValidation &&
                          !effectiveMinimumOrderValidation.isValid
                        ? "Montant minimum non atteint"
                        : ""
                  }
                >
                  <CreditCard size={18} />
                  Passer au paiement
                </button>

              </>
            )}


            {/* Footer */}
            {items.length > 0 && (
              <p className="text-[10px] text-center text-stone-400 uppercase tracking-tighter mt-4">
                Paiements sécurisés par Square • Taxes calculées au checkout
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default CartDrawer;
