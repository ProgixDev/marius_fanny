import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, CreditCard, MapPin, ShoppingBag, CheckCircle2, AlertTriangle, Calendar, Clock } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import SquarePaymentForm from "../components/SquarePaymentForm";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { authClient, normalizedApiUrl } from "../lib/AuthClient";
import { productAPI } from "../lib/ProductAPI";
import { promoAPI } from "../lib/PromoAPI";
import { clearCart } from "../utils/cartPersistence";
import { getErrorMessage } from "../utils/errorMessage";
import { authHeaders } from "../utils/authHeaders";
import { useSettings } from "../lib/SettingsContext";

interface CartItem {
  id: number;
  name: string;
  price: number;
  image: string;
  quantity: number;
  cartItemKey?: string;
  selectedOptions?: Record<string, string>;
  preparationTimeHours?: number;
  availableDays?: number[];
}

interface CheckoutState {
  items: CartItem[];
  postalCode: string;
  deliveryType: "pickup" | "delivery";
  pickupLocation?: "Montreal" | "Laval";
  deliveryFee: number;
  proDeliveryDistanceTier?: "lt20" | "gt20";
  subtotal: number;
  discount?: number;
  promoCode?: string;
  taxes: number;
  total: number;
}

const Checkout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const siteSettings = useSettings();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const stateFromNav = location.state as CheckoutState | undefined;
  const state: CheckoutState | null =
    stateFromNav ||
    (() => {
      try {
        const raw = localStorage.getItem("checkout_data");
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed as CheckoutState;
      } catch {
        return null;
      }
    })();

  useEffect(() => {
    if (!state) {
      navigate("/", { replace: true });
    }
  }, [navigate, state]);

  if (!state) return null;

  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");

  // Champs adresse de livraison
  const [deliveryStreet, setDeliveryStreet] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [deliveryContactPhone, setDeliveryContactPhone] = useState("");
  const [deliveryDetails, setDeliveryDetails] = useState("");
  const [dateValidationError, setDateValidationError] = useState("");
  const [timeSlotError, setTimeSlotError] = useState("");
  const [isProAccount, setIsProAccount] = useState(false);
  const [currentStep, setCurrentStep] = useState<
    "contact" | "delivery" | "payment"
  >("contact");
  const [isLoadingUserData, setIsLoadingUserData] = useState(true);
  const [availableTimeSlots, setAvailableTimeSlots] = useState<string[]>([]);
  const [paymentResultModal, setPaymentResultModal] = useState<{
    isOpen: boolean;
    type: "details" | "warning";
    title: string;
    content: React.ReactNode;
    onClose: () => void;
  }>({
    isOpen: false,
    type: "details",
    title: "",
    content: null,
    onClose: () => {},
  });

  const formatDisplayDate = (dateString: string) =>
    new Date(`${dateString}T00:00:00`).toLocaleDateString("fr-CA", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  // Delivery time slots configuration - MODIFIÉ POUR RAMASSAGE
  const getAvailableTimeSlots = (selectedDate: string) => {
    if (!selectedDate) return [];

    // Pour le ramassage, proposer des heures fixes
    if (state?.deliveryType === "pickup") {
      const slots = [
        "07:00",
        "08:00",
        "09:00",
        "10:00",
        "11:00",
        "12:00",
        "13:00",
        "14:00",
        "15:00",
        "16:00",
        "17:00",
      ];
      // Montréal: heure max 17h — Laval: jusqu'à 18h
      if (state.pickupLocation !== "Montreal") {
        slots.push("18:00");
      }
      return slots;
    }

    const date = new Date(selectedDate + "T00:00:00");
    const dayOfWeek = date.getDay(); // 0 = dimanche, 6 = samedi

    // Weekend (samedi = 6, dimanche = 0)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return [
        "08:00 - 09:00",
        "09:00 - 10:00",
        "10:00 - 11:00",
        "11:00 - 12:00"
      ];
    }

    // Semaine (lundi à vendredi)
    return [
      "08:00 - 09:00",
      "09:00 - 10:00",
      "10:00 - 11:00",
      "11:00 - 11:30",
      "11:30 - 12:00",
      "12:00 - 12:30",
      "12:30 - 13:00",
      "13:00 - 13:30",
      "13:30 - 14:00"
    ];
  };

  // Read "now" through the bakery's clock (America/Montreal), not the
  // customer's. Otherwise a user browsing from Tunisia at 18h00 Tunis
  // (= 12h00 Montréal) would be told "trop tard, on est passé 14h" while
  // the backend — which always uses Montréal time — would happily accept it.
  const getMontrealNow = () => {
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
  };

  // We tell customers the cutoff is 14h00 but the real backend gate is
  // 14h15 — that 15-minute buffer absorbs hesitation/clock skew and lets
  // staff/regulars sneak in a last-minute order without showing two
  // different times across the UI.
  const CUTOFF_MINUTES = 14 * 60 + 15;
  const isPastCutoff = (m: { hour: number; minute: number }) =>
    m.hour * 60 + m.minute >= CUTOFF_MINUTES;

  // Calculate minimum delivery date based on preparation times
  const getMinimumDeliveryDate = () => {
    const m = getMontrealNow();
    // Build a local-midnight Date that represents today in Montréal —
    // formatDateForInput later reads it via .getFullYear/.getMonth/.getDate
    // (browser-local), so creating with `new Date(y, m-1, d)` yields the
    // right calendar day in the input field regardless of TZ.
    const buildLocalMidnight = (y: number, mm: number, d: number) =>
      new Date(y, mm - 1, d, 0, 0, 0, 0);

    if (!state?.items || state.items.length === 0) {
      const t = buildLocalMidnight(m.year, m.month, m.day + 1);
      return t;
    }

    const maxPreparationHours = Math.max(
      ...state.items.map((item) => item.preparationTimeHours || 0),
    );

    // 0h = same day, 24h = next day, 48h = day-after-tomorrow, etc.
    const prepDays = Math.ceil(maxPreparationHours / 24);

    // 14h Montréal cutoff (actual gate: 14h15, with a hidden 15-minute
    // margin so customers don't see two different times in the UI). Past
    // the cutoff, the lead time is bumped by one day. Date constructor
    // handles month/year overflow when day > daysInMonth.
    const cutoffPenalty = isPastCutoff(m) ? 1 : 0;
    return buildLocalMidnight(m.year, m.month, m.day + prepDays + cutoffPenalty);
  };

  // Format date for input field (YYYY-MM-DD)
  const formatDateForInput = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const minDeliveryDate = formatDateForInput(getMinimumDeliveryDate());
  const maxPreparationTime = state?.items
    ? Math.max(...state.items.map((item) => item.preparationTimeHours || 0))
    : 0;

  // Get products that require the maximum preparation time
  const getProductsRequiringMaxPreparation = () => {
    if (!state?.items) return [];
    return state.items.filter(
      (item) => item.preparationTimeHours === maxPreparationTime,
    );
  };

  // Validate the selected delivery date
  const validateDeliveryDate = (selectedDate: string) => {
    if (!selectedDate) {
      setDateValidationError("");
      return true;
    }

    // Parse selected date and normalize to midnight local time
    const selected = new Date(selectedDate + "T00:00:00");
    const minDate = getMinimumDeliveryDate();

    // Compare dates (both at midnight)
    if (selected < minDate) {
      const daysNeeded = Math.ceil(maxPreparationTime / 24);
      const productsRequiringTime = getProductsRequiringMaxPreparation();
      const productNames = productsRequiringTime.map((p) => p.name).join(", ");

      const noonCutoffMessage = isPastCutoff(getMontrealNow())
        ? " Note: passé 14h00 (heure de Montréal), le délai de préparation est repoussé d'une journée."
        : "";

      setDateValidationError(
        `❌ Date trop tôt! Les produits suivants nécessitent ${maxPreparationTime}h (${daysNeeded} jour${daysNeeded > 1 ? "s" : ""}) de préparation: ${productNames}. Date minimum: ${minDate.toLocaleDateString("fr-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.${noonCutoffMessage}`,
      );
      return false;
    }

    // Check closed dates
    const mmdd = selectedDate.slice(5); // "YYYY-MM-DD" -> "MM-DD"
    if (siteSettings.closedDates && siteSettings.closedDates.includes(mmdd)) {
      setDateValidationError(
        "Le magasin est fermé à cette date. Veuillez choisir une autre date."
      );
      return false;
    }

    setDateValidationError("");
    return true;
  };

  // Handle date change with real-time validation
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value;
    setDeliveryDate(newDate);
    validateDeliveryDate(newDate);
    
    // Mettre à jour les créneaux disponibles quand la date change
    if (newDate) {
      setAvailableTimeSlots(getAvailableTimeSlots(newDate));
      // Réinitialiser l'heure sélectionnée
      setDeliveryTime("");
      setTimeSlotError("");
    }
  };

  // Handle time slot selection - MODIFIÉ POUR RAMASSAGE
  const handleTimeSlotChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    setDeliveryTime(e.target.value);
    setTimeSlotError("");
  };

  useEffect(() => {
    console.log("🛒 [CHECKOUT] Component mounted, state:", state);
    if (!state || !state.items || state.items.length === 0) {
      console.log("⚠️ [CHECKOUT] No checkout data, redirecting to home");
      navigate("/");
    } else {
      console.log("✅ [CHECKOUT] Valid checkout data received:", {
        itemsCount: state.items.length,
        deliveryType: state.deliveryType,
        pickupLocation: state.pickupLocation,
        total: state.total,
      });
    }
  }, [state, navigate]);

  // Load user data for pre-populating contact information
  useEffect(() => {
    const loadUserData = async () => {
      try {
        console.log(
          "👤 [CHECKOUT] Loading user data for contact information...",
        );
        const response = await fetch(`${normalizedApiUrl}/api/users/me`, {
          headers: authHeaders(),
          credentials: "include",
        });

        if (response.ok) {
          const result = await response.json();
          const user = result.data;

          // Pre-populate contact information from user account
          setCustomerName(user.name || "");
          setCustomerEmail(user.email || "");
          setCustomerPhone(user.profile?.phoneNumber || "");
          setIsProAccount(user.role === "pro");

          console.log(
            "✅ [CHECKOUT] User data loaded and contact fields pre-populated",
          );
        } else {
          console.log(
            "⚠️ [CHECKOUT] Could not load user data, user may need to fill contact info manually",
          );
        }
      } catch (error) {
        console.error("❌ [CHECKOUT] Failed to load user data:", error);
      } finally {
        setIsLoadingUserData(false);
      }
    };

    loadUserData();
  }, []);

  if (!state || !state.items) {
    return null;
  }

  const handleCustomerFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!customerName.trim()) {
      alert("Veuillez entrer votre nom.");
      return;
    }

    if (!customerEmail.trim() || !customerEmail.includes("@")) {
      alert("Veuillez entrer une adresse email valide.");
      return;
    }

    if (!customerPhone.trim()) {
      alert("Veuillez entrer votre numéro de téléphone.");
      return;
    }

    if (customerPhone.replace(/\D/g, "").length < 7) {
      alert("Le numéro de téléphone doit contenir au moins 7 chiffres.");
      return;
    }

    console.log(
      `👤 [CHECKOUT] Customer info collected: ${customerName} (${customerEmail}, ${customerPhone}), moving to delivery step`,
    );
    setCurrentStep("delivery");
  };

  const handleDeliveryFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!deliveryDate) {
      alert("Veuillez sélectionner une date de livraison.");
      return;
    }

    if (!deliveryTime) {
      alert(
        `Veuillez sélectionner ${state.deliveryType === "delivery" ? "un créneau horaire" : "une heure de ramassage"}.`,
      );
      return;
    }

    // Validation adresse de livraison
    if (state.deliveryType === "delivery") {
      if (!deliveryStreet.trim()) {
        alert("Veuillez entrer l'adresse complète (numéro et rue).");
        return;
      }
      if (!deliveryCity.trim()) {
        alert("Veuillez entrer la ville.");
        return;
      }
      if (!deliveryContactPhone.trim()) {
        alert("Veuillez entrer le numéro de téléphone de la personne à joindre sur place.");
        return;
      }
    }

    // Validate that the selected date is not before the minimum date
    if (!validateDeliveryDate(deliveryDate)) {
      // Error message already set by validateDeliveryDate
      return;
    }

    // Validate product availability for the selected day of week.
    // We fetch product details from API to avoid relying only on cart payload.
    const DAYS_FR = [
      "Dimanche",
      "Lundi",
      "Mardi",
      "Mercredi",
      "Jeudi",
      "Vendredi",
      "Samedi",
    ];
    const selectedDayOfWeek = new Date(deliveryDate + "T12:00:00").getDay();

    const availabilityByProductId = new Map<number, number[] | undefined>();
    await Promise.all(
      state.items.map(async (item) => {
        try {
          const resp = await productAPI.getProductById(item.id);
          const days = resp?.data?.availableDays;
          availabilityByProductId.set(
            item.id,
            Array.isArray(days) ? days.map((d) => Number(d)) : item.availableDays,
          );
        } catch {
          // Fallback to cart value when API lookup fails
          availabilityByProductId.set(item.id, item.availableDays);
        }
      }),
    );

    const unavailableItems = state.items.filter((item) => {
      const days = availabilityByProductId.get(item.id);
      return !!days && days.length > 0 && !days.includes(selectedDayOfWeek);
    });

    if (unavailableItems.length > 0) {
      const details = unavailableItems
        .map((item) => {
          const days = availabilityByProductId.get(item.id) || [];
          return `• ${item.name} — disponible uniquement le : ${days
            .map((d) => DAYS_FR[d])
            .join(", ")}`;
        })
        .join("\n");
      alert(
        `Certains produits ne sont pas disponibles le ${DAYS_FR[selectedDayOfWeek]} :\n${details}\n\nVeuillez choisir une autre date ou retirer ces produits du panier.`,
      );
      return;
    }

    console.log(
      `📅 [CHECKOUT] Delivery info collected: ${deliveryDate}${deliveryTime ? ` - ${deliveryTime}` : ''}, moving to payment step`,
    );
    
    // Validate promo code before going to payment step
    if (state.promoCode) {
      try {
        console.log("🔍 [CHECKOUT] Validating promo code before payment:", state.promoCode);
        const promoResult = await promoAPI.validatePromo({
          code: state.promoCode,
          subtotal: state.subtotal,
          email: customerEmail,
          items: state.items.map((item) => ({
            productId: item.id,
            amount: item.price * item.quantity,
          })),
        });
        
        // If promoResult has data, it means success
        if (!promoResult?.data) {
          alert("Code promo invalide ou expiré");
          return;
        }
        console.log("✅ [CHECKOUT] Promo code validated successfully");
      } catch (promoError: any) {
        console.error("❌ [CHECKOUT] Promo validation failed:", promoError);
        alert(getErrorMessage(promoError, "Code promo invalide ou expiré."));
        return;
      }
    }
    
    setCurrentStep("payment");
  };

  const handlePaymentSuccess = async (paymentResult: any) => {
    const amount = paymentResult.amountMoney?.amount
      ? Number(paymentResult.amountMoney.amount) / 100
      : 0;
    const paymentId = paymentResult.paymentId;
    const status = paymentResult.status;

    console.log(
      `✅ [CHECKOUT] Payment successful! ID: ${paymentId}, Status: ${status}, Amount: ${amount}$, Payment Type: full`,
    );

    try {
      console.log("💾 [CHECKOUT] Saving order to backend...");

      const nameParts = customerName.trim().split(" ");
      const firstName = nameParts[0] || customerName;
      const lastName =
        nameParts.length > 1 ? nameParts.slice(1).join(" ") : "N/A";

      if (isProAccount) {
        const proOrderData = {
          clientInfo: {
            firstName,
            lastName,
            email: customerEmail,
            phone: customerPhone,
          },
          deliveryType: state.deliveryType,
          pickupDate:
            state.deliveryType === "pickup" && deliveryDate
              ? (() => {
                  const m = (deliveryTime || "").match(/^(\d{2}):(\d{2})/);
                  const hhmm = m ? `${m[1]}:${m[2]}` : "00:00";
                  return new Date(`${deliveryDate}T${hhmm}:00`).toISOString();
                })()
              : undefined,
          pickupLocation: state.pickupLocation || "Laval",
          deliveryDate: state.deliveryType === "delivery" ? deliveryDate : undefined,
          // Save deliveryTimeSlot for BOTH pickup and delivery so the production
          // list displays the chosen time reliably (no timezone fallback needed).
          deliveryTimeSlot: deliveryTime || undefined,
          deliveryAddress:
            state.deliveryType === "delivery"
              ? {
                  street: deliveryStreet || "À déterminer",
                  city: deliveryCity || "À déterminer",
                  province: "QC",
                  postalCode: state.postalCode,
                  contactPhone: deliveryContactPhone || undefined,
                  details: deliveryDetails || undefined,
                }
              : undefined,
          deliveryDistanceTier:
            state.deliveryType === "delivery" ? state.proDeliveryDistanceTier : undefined,
          items: state.items.map((item) => ({
            productId: item.id,
            productName: item.name,
            quantity: item.quantity,
            unitPrice: item.price,
            amount: item.price * item.quantity,
            selectedOptions:
              item.selectedOptions && Object.keys(item.selectedOptions).length > 0
                ? item.selectedOptions
                : undefined,
            notes:
              item.selectedOptions && Object.keys(item.selectedOptions).length > 0
                ? Object.entries(item.selectedOptions)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([label, value]) => `${label}: ${value}`)
                    .join(" | ")
                : undefined,
          })),
          notes: `Commande PRO payée (${state.deliveryType === "pickup" ? "Ramassage" : "Livraison"}) - ${deliveryDate}${deliveryTime ? ` ${deliveryTime}` : ""} | Paiement Square: ${paymentId}`,
        };

        const response = await fetch(`${normalizedApiUrl}/api/pro-orders`, {
          method: "POST",
          headers: authHeaders(),
          credentials: "include",
          body: JSON.stringify(proOrderData),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || errorData.message || "Failed to submit pro order");
        }

        const result = await response.json();
        const orderNumber = String(result?.data?.orderNumber || "");

        clearCart();

        setPaymentResultModal({
          isOpen: true,
          type: "details",
          title: "Paiement réussi !",
          content: (
            <div className="space-y-4">
              <div className="flex items-start gap-3 text-green-700 bg-green-50 p-4 rounded-lg border border-green-200">
                <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">Commande pro transmise</p>
                  <p>Votre commande payée a été envoyée à l'admin par email.</p>
                </div>
              </div>
              <div className="space-y-2 text-stone-600 bg-stone-50 p-4 rounded-lg">
                <p>
                  <span className="font-medium">Référence:</span> {orderNumber}
                </p>
                <p>
                  <span className="font-medium">Montant:</span> {amount}$ CAD
                </p>
                <p>
                  <span className="font-medium">Statut:</span> {status}
                </p>
              </div>
            </div>
          ),
          onClose: () => navigate("/pro"),
        });

        return;
      }

      const orderData = {
        clientInfo: {
          firstName: firstName,
          lastName: lastName,
          email: customerEmail,
          phone: customerPhone,
        },
        promoCode: state?.promoCode || undefined,
        deliveryType: state.deliveryType,
        pickupDate:
          state.deliveryType === "pickup" && deliveryDate
            ? new Date(`${deliveryDate}T${deliveryTime || "00:00"}:00`).toISOString()
            : undefined,
        pickupLocation: state.pickupLocation || "Laval",
        deliveryDate: state.deliveryType === "delivery" ? deliveryDate : undefined,
        // Save deliveryTimeSlot for BOTH pickup and delivery. The pickupDate
        // ISO string is built in the browser's local timezone, so when the
        // admin (or formatServiceTime) re-projects it into America/Toronto,
        // the hour drifts. Storing the raw HH:MM string sidesteps any TZ
        // math so the order list always shows the time the customer typed.
        deliveryTimeSlot: deliveryTime || undefined,
        deliveryAddress:
          state.deliveryType === "delivery" && state.postalCode
            ? {
                street: deliveryStreet || "À déterminer",
                city: deliveryCity || "À déterminer",
                province: "QC",
                postalCode: state.postalCode,
                contactPhone: deliveryContactPhone || undefined,
                details: deliveryDetails || undefined,
              }
            : undefined,
        items: state.items.map((item) => ({
          productId: item.id,
          productName: item.name,
          quantity: item.quantity,
          unitPrice: item.price,
          amount: item.price * item.quantity,
          selectedOptions:
            item.selectedOptions && Object.keys(item.selectedOptions).length > 0
              ? item.selectedOptions
              : undefined,
          notes:
            item.selectedOptions && Object.keys(item.selectedOptions).length > 0
              ? Object.entries(item.selectedOptions)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([label, value]) => `${label}: ${value}`)
                  .join(" | ")
              : undefined,
        })),
        paymentType: "full",
        depositPaid: true,
        squarePaymentId: paymentId,
        notes: `Square Payment ID: ${paymentId} | ${state.deliveryType === 'pickup' ? 'Ramassage' : 'Livraison'} prévu${state.deliveryType === 'pickup' ? '' : 'e'}: ${deliveryDate}${deliveryTime ? ` ${deliveryTime}` : ''}`,
      };

      const response = await fetch(`${normalizedApiUrl}/api/orders`, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify(orderData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save order");
      }

      const result = await response.json();
      const rawOrderNumber = result?.data?.orderNumber || "";
      const orderDigitsMatch = String(rawOrderNumber).trim().match(/-(\d{1,4})$/);
      const displayOrderNumber = orderDigitsMatch
        ? orderDigitsMatch[1].padStart(4, "0")
        : String(rawOrderNumber);
      console.log("✅ [CHECKOUT] Order saved successfully:", result);

      clearCart();

      setPaymentResultModal({
        isOpen: true,
        type: "details",
        title: "Paiement réussi!",
        content: (
          <div className="space-y-4">
            <div className="flex items-start gap-3 text-green-700 bg-green-50 p-4 rounded-lg border border-green-200">
              <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Commande confirmée</p>
                {state.deliveryType !== 'pickup' && (
                  <p>Nous livrons vos produits directement à la réception.</p>
                )}
              </div>
            </div>
            <div className="space-y-2 text-stone-600 bg-stone-50 p-4 rounded-lg">
              <p>
                <span className="font-medium">Numéro de commande:</span>{" "}
                {displayOrderNumber}
              </p>
              <p>
                <span className="font-medium">Montant:</span> {amount}$ CAD
              </p>
              <p>
                <span className="font-medium">Statut:</span> {status}
              </p>
            </div>
            <p className="text-stone-500 text-sm">
              Votre commande a été confirmée. Vous recevrez un email de
              confirmation sous peu.
            </p>
          </div>
        ),
        onClose: () => {
          console.log("🏠 [CHECKOUT] Redirecting to home page");
          navigate("/");
        },
      });
    } catch (error) {
      console.error("❌ [CHECKOUT] Failed to save order:", error);
      setPaymentResultModal({
        isOpen: true,
        type: "warning",
        title: "Attention requise",
        content: (
          <div className="space-y-4">
            <div className="flex items-start gap-3 text-amber-700 bg-amber-50 p-4 rounded-lg border border-amber-200">
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Problème d'enregistrement</p>
                <p>
                  Le paiement a été effectué, mais l'enregistrement de la
                  commande a échoué.
                </p>
              </div>
            </div>
            <div className="text-stone-600">
              <p>
                Veuillez contacter le support avec cet identifiant de paiement :
              </p>
              <code className="block mt-2 bg-stone-100 p-2 rounded text-sm text-stone-800">
                {paymentId}
              </code>
            </div>
          </div>
        ),
        onClose: () => navigate("/"),
      });
    }
  };

  const handlePaymentError = (error: any) => {
    console.error("❌ [CHECKOUT] Payment failed:", error);

    let errorMessage = "Une erreur est survenue lors du paiement.";

    if (error.message) {
      if (error.message.includes("card")) {
        errorMessage =
          "❌ Erreur de carte de crédit. Vérifiez les informations de votre carte et réessayez.";
      } else if (error.message.includes("network")) {
        errorMessage =
          "🌐 Erreur de connexion réseau. Vérifiez votre connexion internet et réessayez.";
      } else if (error.message.includes("declined")) {
        errorMessage =
          "🚫 Paiement refusé par votre banque. Contactez votre banque ou utilisez une autre carte.";
      } else if (error.message.includes("expired")) {
        errorMessage = "⏰ Carte expirée. Utilisez une carte valide.";
      } else if (error.message.includes("insufficient")) {
        errorMessage =
          "💸 Fonds insuffisants. Vérifiez votre solde ou utilisez une autre carte.";
      } else {
        errorMessage = `❌ ${getErrorMessage(error, "Erreur de paiement. Veuillez réessayer.")}`;
      }
    }

    setPaymentResultModal({
      isOpen: true,
      type: "warning",
      title: "Échec du paiement",
      content: (
        <div className="space-y-4">
          <p className="text-red-600 font-medium">{errorMessage}</p>
          <p className="text-stone-600 text-sm">
            Veuillez réessayer ou contacter le support si le problème persiste.
          </p>
        </div>
      ),
      onClose: () => {},
    });
  };

  return (
    <>
      <Navbar onCartClick={() => {}} cartCount={state.items.length} />

      <div
        className="min-h-screen pt-24 pb-12 px-4"
        style={{ backgroundColor: "#F9F7F2" }}
      >
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 text-stone-600 hover:text-[#337957] transition-colors mb-4"
            >
              <ArrowLeft size={20} />
              Retour
            </button>
            <h1
              className="text-4xl md:text-5xl mb-2"
              style={{
                fontFamily: "'Great Vibes', cursive",
                color: "#337957",
              }}
            >
              {currentStep === "contact" && "Informations client"}
              {currentStep === "delivery" && (state.deliveryType === "delivery" ? "Créneau de livraison" : "Date de ramassage")}
              {currentStep === "payment" && "Paiement sécurisé"}
            </h1>
            <p className="text-stone-600">
              {currentStep === "contact" && "Renseignez vos coordonnées"}
              {currentStep === "delivery" &&
                (state.deliveryType === "delivery" ? "Choisissez votre créneau de livraison" : "Choisissez votre date de ramassage")}
              {currentStep === "payment" &&
                "Finalisez votre commande en toute sécurité"}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Left Column - Multi-step Checkout */}
            <div className="space-y-6">
              {/* Step 1: Contact Information */}
              {currentStep === "contact" && (
                <div className="bg-white rounded-2xl p-6 shadow-lg">
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 bg-[#337957] text-white rounded-full flex items-center justify-center text-sm font-bold">
                        1
                      </div>
                      <h2 className="text-xl font-serif text-[#2D2A26]">
                        Informations de contact
                      </h2>
                    </div>
                    <div className="w-full bg-stone-200 rounded-full h-2">
                      <div
                        className="bg-[#337957] h-2 rounded-full"
                        style={{ width: "33%" }}
                      ></div>
                    </div>
                  </div>
                  <p className="text-sm text-stone-500 mb-4">
                    {isLoadingUserData
                      ? "Chargement de vos informations..."
                      : "Vos informations de compte ont été pré-remplies. Vous pouvez les modifier si nécessaire."}
                  </p>
                  <form
                    onSubmit={handleCustomerFormSubmit}
                    className="space-y-4"
                  >
                    <div>
                      <label className="block text-sm text-stone-600 mb-2">
                        Nom complet *
                      </label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Jean Dupont"
                        className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#337957]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-stone-600 mb-2">
                        Email *
                      </label>
                      <input
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        placeholder="jean.dupont@example.com"
                        className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#337957]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-stone-600 mb-2">
                        Téléphone *
                      </label>
                      <input
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="(514) 123-4567"
                        pattern="[0-9\s\-\(\)\.\+]{7,}"
                        title="Numéro de téléphone (au moins 7 chiffres)"
                        className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#337957]"
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-[#2D2A26] text-white py-4 rounded-xl font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-3 hover:bg-[#337957] transition-all shadow-lg"
                    >
                      Suivant: {state.deliveryType === "delivery" ? "Créneau de livraison" : "Date de ramassage"}
                      <ArrowLeft size={18} className="rotate-180" />
                    </button>
                  </form>
                </div>
              )}

              {/* Step 2: Delivery Time Slot - MODIFIÉ POUR RAMASSAGE */}
              {currentStep === "delivery" && (
                <div className="bg-white rounded-2xl p-6 shadow-lg">
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 bg-[#337957] text-white rounded-full flex items-center justify-center text-sm font-bold">
                        2
                      </div>
                      <h2 className="text-xl font-serif text-[#2D2A26]">
                        {state.deliveryType === "delivery" ? "Créneau de livraison" : "Date de ramassage"}
                      </h2>
                    </div>
                    <div className="w-full bg-stone-200 rounded-full h-2">
                      <div
                        className="bg-[#337957] h-2 rounded-full"
                        style={{ width: "66%" }}
                      ></div>
                    </div>
                  </div>

                  {maxPreparationTime > 0 && (
                    <div
                      className="mb-6 p-4 rounded-lg"
                      style={{
                        backgroundColor:
                          maxPreparationTime >= 48 ? "#fef2f2" : "#fffbeb",
                        borderLeft: `4px solid ${maxPreparationTime >= 48 ? "#dc2626" : "#d97706"}`,
                      }}
                    >
                      <p
                        className="text-sm font-medium"
                        style={{
                          color:
                            maxPreparationTime >= 48 ? "#dc2626" : "#d97706",
                        }}
                      >
                        ⏰ Temps de préparation requis:{" "}
                        {maxPreparationTime >= 24
                          ? `${Math.ceil(maxPreparationTime / 24)} jour${Math.ceil(maxPreparationTime / 24) > 1 ? "s" : ""}`
                          : `${maxPreparationTime} heure${maxPreparationTime > 1 ? "s" : ""}`}
                      </p>
                      <p className="text-xs mt-2 text-stone-600">
                        <strong>Produit(s) concerné(s):</strong>{" "}
                        {getProductsRequiringMaxPreparation()
                          .map((p) => `${p.name} (${p.preparationTimeHours}h)`)
                          .join(", ")}
                      </p>
                      <p className="text-xs mt-2 text-stone-600">
                        📅 {state.deliveryType === "delivery" ? "Livraison" : "Ramassage"} disponible à partir du{" "}
                        {formatDisplayDate(minDeliveryDate)}
                      </p>
                      {maxPreparationTime === 24 && state.deliveryType === "delivery" && (
                        <p className="text-xs mt-2 text-stone-600 font-medium">
                          🕐 Pour une livraison le lendemain, commandez avant
                          14h00
                        </p>
                      )}
                    </div>
                  )}

                  <form
                    onSubmit={handleDeliveryFormSubmit}
                    className="space-y-4"
                  >
                    <div>
                      <label className="block text-sm text-stone-600 mb-2">
                        Date *
                      </label>
                      <input
                        type="date"
                        value={deliveryDate}
                        onChange={handleDateChange}
                        min={minDeliveryDate}
                        className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 ${
                          dateValidationError
                            ? "border-red-500 focus:ring-red-500"
                            : "border-stone-300 focus:ring-[#337957]"
                        }`}
                        required
                      />
                      {dateValidationError && (
                        <p className="mt-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
                          {dateValidationError}
                        </p>
                      )}
                      {deliveryDate && !dateValidationError && (
                        <p className="mt-2 text-sm text-green-600 bg-green-50 p-3 rounded-lg border border-green-200">
                          ✅ Date valide! {state.deliveryType === "delivery" ? "Livraison" : "Ramassage"} prévu le{" "}
                          {formatDisplayDate(deliveryDate)}
                        </p>
                      )}
                    </div>

                    {/* Pour la livraison: sélecteur de créneaux */}
                    {state.deliveryType === "delivery" && (
                      <div>
                        <label className="flex text-sm text-stone-600 mb-2 items-center gap-2">
                          <Clock size={16} />
                          Créneau horaire *
                        </label>
                        <select
                          value={deliveryTime}
                          onChange={handleTimeSlotChange}
                          className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#337957] bg-white"
                          required
                          disabled={!deliveryDate || !!dateValidationError}
                        >
                          <option value="">Sélectionnez un créneau</option>
                          {availableTimeSlots.map((slot, index) => (
                            <option key={index} value={slot}>
                              {slot}
                            </option>
                          ))}
                        </select>
                        {deliveryTime && (
                          <p className="mt-2 text-sm text-green-600 bg-green-50 p-3 rounded-lg border border-green-200">
                            ✅ Créneau sélectionné: {deliveryTime}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Adresse de livraison — affiché uniquement pour la livraison */}
                    {state.deliveryType === "delivery" && (
                      <div className="space-y-3 mt-2">
                        <h3 className="text-sm font-semibold text-[#2D2A26] flex items-center gap-2">
                          <MapPin size={15} className="text-[#337957]" />
                          Adresse de livraison
                        </h3>

                        {/* Encadré rouge — hôpitaux et écoles */}
                        <div className="border-2 border-red-500 rounded-xl p-4 bg-red-50">
                          <p className="text-sm font-bold text-red-700 mb-1">
                            ⚠️ Hôpitaux &amp; Écoles
                          </p>
                          <p className="text-xs text-red-600 leading-relaxed">
                            Pour les livraisons en <strong>hôpital</strong> ou en <strong>école</strong>,
                            la livraison s'effectue <strong>à l'accueil uniquement</strong>.
                            Assurez-vous que quelqu'un sera présent à l'accueil pour réceptionner la commande.
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm text-stone-600 mb-1">
                            Adresse complète (numéro et rue) *
                          </label>
                          <input
                            type="text"
                            value={deliveryStreet}
                            onChange={(e) => setDeliveryStreet(e.target.value)}
                            placeholder="1234 Rue Exemple"
                            className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#337957]"
                            required
                          />
                        </div>

                        <div>
                          <label className="block text-sm text-stone-600 mb-1">
                            Ville *
                          </label>
                          <input
                            type="text"
                            value={deliveryCity}
                            onChange={(e) => setDeliveryCity(e.target.value)}
                            placeholder="Montréal"
                            className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#337957]"
                            required
                          />
                        </div>

                        <div>
                          <label className="block text-sm text-stone-600 mb-1">
                            Téléphone de la personne à joindre sur place *
                          </label>
                          <input
                            type="tel"
                            value={deliveryContactPhone}
                            onChange={(e) => setDeliveryContactPhone(e.target.value)}
                            placeholder="(514) 123-4567"
                            className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#337957]"
                            required
                          />
                        </div>

                        <div>
                          <label className="block text-sm text-stone-600 mb-1">
                            Détails (numéro de porte, étage, appartement…)
                          </label>
                          <input
                            type="text"
                            value={deliveryDetails}
                            onChange={(e) => setDeliveryDetails(e.target.value)}
                            placeholder="Ex : App. 302, 3e étage, sonner 2 fois"
                            className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#337957]"
                          />
                        </div>
                      </div>
                    )}

                    {/* Pour le ramassage: heure obligatoire */}
                    {state.deliveryType === "pickup" && (
                      <div>
                        <label className="flex text-sm text-stone-600 mb-2 items-center gap-2">
                          <Clock size={16} />
                          Heure de ramassage *
                        </label>
                        <select
                          value={deliveryTime}
                          onChange={handleTimeSlotChange}
                          className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#337957] bg-white"
                          disabled={!deliveryDate || !!dateValidationError}
                          required
                        >
                          <option value="">Sélectionnez une heure</option>
                          {availableTimeSlots.map((slot, index) => (
                            <option key={index} value={slot}>
                              {slot}
                            </option>
                          ))}
                        </select>
                        {deliveryTime && (
                          <p className="mt-2 text-sm text-green-600 bg-green-50 p-3 rounded-lg border border-green-200">
                            ✅ Heure sélectionnée: {deliveryTime}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex gap-3 pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentStep("contact");
                          setDateValidationError("");
                          setTimeSlotError("");
                        }}
                        className="flex-1 bg-stone-200 text-stone-700 py-4 rounded-xl font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-3 hover:bg-stone-300 transition-all"
                      >
                        <ArrowLeft size={18} />
                        Retour
                      </button>
                      <button
                        type="submit"
                        disabled={!!dateValidationError || !deliveryTime}
                        className={`flex-1 py-4 rounded-xl font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-3 transition-all shadow-lg ${
                          (!!dateValidationError || !deliveryTime)
                            ? "bg-stone-400 text-stone-600 cursor-not-allowed"
                            : "bg-[#2D2A26] text-white hover:bg-[#337957]"
                        }`}
                      >
                        Paiement
                        <ArrowLeft size={18} className="rotate-180" />
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Step 3: Payment */}
              {currentStep === "payment" && (
                <div className="bg-white rounded-2xl p-6 shadow-lg">
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 bg-[#337957] text-white rounded-full flex items-center justify-center text-sm font-bold">
                        3
                      </div>
                      <h2 className="text-xl font-serif text-[#2D2A26]">
                        Informations de paiement
                      </h2>
                    </div>
                    <div className="w-full bg-stone-200 rounded-full h-2">
                      <div
                        className="bg-[#337957] h-2 rounded-full"
                        style={{ width: "100%" }}
                      ></div>
                    </div>
                  </div>
                  <p className="text-sm text-stone-500 mb-4">
                    Montant à payer: {state.total.toFixed(2)}$ CAD (Paiement
                    complet)
                  </p>
                  <div className="mb-4 p-3 bg-stone-50 rounded-lg">
                    <p className="text-sm text-stone-600">
                      <strong>Client:</strong> {customerName}
                    </p>
                    <p className="text-sm text-stone-600">
                      <strong>{state.deliveryType === "delivery" ? "Livraison" : "Ramassage"}:</strong>{" "}
                      {formatDisplayDate(deliveryDate)}
                      {deliveryTime && ` - ${deliveryTime}`}
                    </p>
                  </div>
                  {isProAccount && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 mb-3">
                      Après paiement, la commande pro sera envoyée directement à l'admin par email.
                    </div>
                  )}
                  <SquarePaymentForm
                    amount={state.total}
                    onPaymentSuccess={handlePaymentSuccess}
                    onPaymentError={handlePaymentError}
                    customerEmail={customerEmail}
                    customerName={customerName}
                    deliveryAddress={{
                      postalCode: state.postalCode,
                      street: "",
                      city: "",
                      province: "",
                    }}
                  />
                  <button
                    onClick={() => setCurrentStep("delivery")}
                    className="w-full mt-4 bg-stone-200 text-stone-700 py-3 rounded-xl font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-3 hover:bg-stone-300 transition-all"
                  >
                    <ArrowLeft size={18} />
                    Retour à la date
                  </button>
                </div>
              )}
            </div>

            {/* Right Column - Order Summary */}
            <div className="space-y-6">
              {/* Delivery Info */}
              <div className="bg-white rounded-2xl p-6 shadow-lg">
                <div className="flex items-center gap-2 mb-4">
                  <MapPin size={20} className="text-[#337957]" />
                  <h2 className="text-xl font-serif text-[#2D2A26]">
                    {state.deliveryType === "delivery" ? "Livraison" : "Ramassage"}
                  </h2>
                </div>
                <p className="text-stone-600">
                  {state.deliveryType === "pickup"
                    ? "Récupération"
                    : "Livraison"}
                  :{" "}
                  <span className="font-bold">
                    {state.deliveryType === "pickup"
                      ? `${state.pickupLocation || "Laval"}`
                      : state.postalCode}
                  </span>
                </p>
                {state.deliveryType === "delivery" && (
                  <p className="text-stone-600 text-sm mt-2">
                    Frais de livraison: {state.deliveryFee.toFixed(2)} $
                  </p>
                )}
              </div>

              {/* Order Summary */}
              <div className="bg-white rounded-2xl p-6 shadow-lg">
                <div className="flex items-center gap-2 mb-4">
                  <ShoppingBag size={20} className="text-[#337957]" />
                  <h2 className="text-xl font-serif text-[#2D2A26]">
                    Votre commande
                  </h2>
                </div>

                <div className="space-y-3 mb-4">
                  {state.items.map((item) => (
                    <div key={item.id} className="text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-stone-600">
                          {item.name} × {item.quantity}
                        </span>
                        <span className="font-medium">
                          {(item.price * item.quantity).toFixed(2)} $
                        </span>
                      </div>
                      {item.preparationTimeHours &&
                        item.preparationTimeHours > 0 && (
                          <div
                            className="mt-1 p-2 rounded text-xs"
                            style={{
                              backgroundColor:
                                item.preparationTimeHours >= 24
                                  ? "#fef2f2"
                                  : item.preparationTimeHours >= 12
                                    ? "#fffbeb"
                                    : "#f0fdf4",
                              color:
                                item.preparationTimeHours >= 24
                                  ? "#dc2626"
                                  : item.preparationTimeHours >= 12
                                    ? "#d97706"
                                    : "#16a34a",
                            }}
                          >
                            ⏰{" "}
                            {item.preparationTimeHours >= 24
                              ? `Préparation: ${item.preparationTimeHours / 24} jour${item.preparationTimeHours / 24 > 1 ? "s" : ""} requis`
                              : item.preparationTimeHours >= 12
                                ? `Préparation: ${item.preparationTimeHours} heures requises`
                                : `Prêt en ${item.preparationTimeHours} heure${item.preparationTimeHours > 1 ? "s" : ""}`}
                          </div>
                        )}
                    </div>
                  ))}
                </div>

                <div className="border-t border-stone-200 pt-4 space-y-2">
                  <div className="flex justify-between text-stone-600">
                    <span>Sous-total</span>
                    <span>{state.subtotal.toFixed(2)} $</span>
                  </div>
                  {!!state.discount && state.discount > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Réduction{state.promoCode ? ` (${state.promoCode})` : ""}</span>
                      <span>-{state.discount.toFixed(2)} $</span>
                    </div>
                  )}
                  {state.deliveryType === "delivery" && (
                    <div className="flex justify-between text-stone-600">
                      <span>Livraison</span>
                      <span>{state.deliveryFee.toFixed(2)} $</span>
                    </div>
                  )}
                  {state.taxes > 0 && (
                    <div className="flex justify-between text-stone-600">
                      <span>Taxes</span>
                      <span>{state.taxes.toFixed(2)} $</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xl font-serif text-[#2D2A26] pt-2 border-t border-stone-200">
                    <span>Total</span>
                    <span className="text-[#337957]">
                      {state.total.toFixed(2)} $
                    </span>
                  </div>
                </div>
              </div>

              {/* Security Notice */}
              <p className="text-xs text-center text-stone-400 uppercase tracking-wider">
                🔒 Paiements sécurisés par Square
              </p>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={paymentResultModal.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            paymentResultModal.onClose();
            setPaymentResultModal((prev) => ({ ...prev, isOpen: false }));
          }
        }}
        type={paymentResultModal.type}
        title={paymentResultModal.title}
        closable={true}
      >
        {paymentResultModal.content}
      </Modal>

      <Footer />
    </>
  );
};

export default Checkout;
