import { useState, useEffect } from "react";
import { useRefreshSettings } from "../lib/SettingsContext";
import {
  Store,
  Mail,
  Phone,
  MapPin,
  Clock,
  Bell,
  Globe,
  AlertCircle,
  Facebook,
  Instagram,
  Twitter,
  Save,
  Loader2,
  CalendarOff,
  Plus,
  X,
} from "lucide-react";
import { authHeaders } from "../utils/authHeaders";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const normalizedApiUrl = API_URL.startsWith("http") ? API_URL : `https://${API_URL}`;

interface BusinessHours {
  [key: string]: { open: string; close: string; closed: boolean };
}

interface Settings {
  storeName: string;
  contactEmail: string;
  contactPhone: string;
  contactPhoneMontreal: string;
  address: string;
  addressMontreal: string;
  businessHoursLaval: BusinessHours;
  businessHoursMontreal: BusinessHours;
  emailOnNewOrder: boolean;
  emailOnOrderConfirmed: boolean;
  emailOnPaymentReceived: boolean;
  emailOnOrderReady: boolean;
  closedDates: string[];
  facebookUrl: string;
  instagramUrl: string;
  twitterUrl: string;
}

const defaultSettings: Settings = {
  storeName: "Pâtisserie Provençale",
  contactEmail: "contact@mariusfanny.com",
  contactPhone: "450-689-0655",
  contactPhoneMontreal: "514-379-1898",
  address: "239-E Boulevard Samson, Laval",
  addressMontreal: "2006 rue St-Hubert, Montréal",
  businessHoursLaval: {
    monday: { open: "07:00", close: "18:00", closed: false },
    tuesday: { open: "07:00", close: "18:00", closed: false },
    wednesday: { open: "07:00", close: "18:00", closed: false },
    thursday: { open: "07:00", close: "18:00", closed: false },
    friday: { open: "07:00", close: "18:30", closed: false },
    saturday: { open: "08:00", close: "18:00", closed: false },
    sunday: { open: "08:00", close: "18:00", closed: false },
  },
  businessHoursMontreal: {
    monday: { open: "07:00", close: "17:00", closed: false },
    tuesday: { open: "07:00", close: "17:00", closed: false },
    wednesday: { open: "07:00", close: "17:00", closed: false },
    thursday: { open: "07:00", close: "17:00", closed: false },
    friday: { open: "07:00", close: "17:00", closed: false },
    saturday: { open: "08:00", close: "17:00", closed: false },
    sunday: { open: "08:00", close: "17:00", closed: false },
  },
  emailOnNewOrder: true,
  emailOnOrderConfirmed: true,
  emailOnPaymentReceived: true,
  emailOnOrderReady: true,
  closedDates: ["01-01", "12-25"],
  facebookUrl: "https://www.facebook.com/mariusetfanny/",
  instagramUrl: "https://www.instagram.com/patisseriemariusetfanny/",
  twitterUrl: "",
};

export default function SettingsManagement() {
  const refreshGlobalSettings = useRefreshSettings();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${normalizedApiUrl}/api/settings`);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        setSettings({
          storeName: d.storeName ?? defaultSettings.storeName,
          contactEmail: d.contactEmail ?? defaultSettings.contactEmail,
          contactPhone: d.contactPhone ?? defaultSettings.contactPhone,
          contactPhoneMontreal: d.contactPhoneMontreal ?? defaultSettings.contactPhoneMontreal,
          address: d.address ?? defaultSettings.address,
          addressMontreal: d.addressMontreal ?? defaultSettings.addressMontreal,
          businessHoursLaval: d.businessHoursLaval ?? defaultSettings.businessHoursLaval,
          businessHoursMontreal: d.businessHoursMontreal ?? defaultSettings.businessHoursMontreal,
          emailOnNewOrder: d.emailOnNewOrder ?? defaultSettings.emailOnNewOrder,
          emailOnOrderConfirmed: d.emailOnOrderConfirmed ?? defaultSettings.emailOnOrderConfirmed,
          emailOnPaymentReceived: d.emailOnPaymentReceived ?? defaultSettings.emailOnPaymentReceived,
          emailOnOrderReady: d.emailOnOrderReady ?? defaultSettings.emailOnOrderReady,
          facebookUrl: d.facebookUrl ?? defaultSettings.facebookUrl,
          instagramUrl: d.instagramUrl ?? defaultSettings.instagramUrl,
          closedDates: d.closedDates ?? defaultSettings.closedDates,
          twitterUrl: d.twitterUrl ?? defaultSettings.twitterUrl,
        });
      }
    } catch {
      // Use defaults on error
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: keyof Settings, value: any) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleBusinessHoursChange = (
    location: "businessHoursLaval" | "businessHoursMontreal",
    day: string,
    field: "open" | "close" | "closed",
    value: string | boolean
  ) => {
    setSettings((prev) => ({
      ...prev,
      [location]: {
        ...prev[location],
        [day]: {
          ...prev[location][day],
          [field]: value,
        },
      },
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage("");
    setSaveError("");
    try {
      const res = await fetch(`${normalizedApiUrl}/api/settings`, {
        method: "PUT",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (json.success) {
        setSaveMessage("Paramètres enregistrés avec succès!");
        setTimeout(() => setSaveMessage(""), 3000);
        refreshGlobalSettings();
      } else {
        setSaveError(json.message || "Erreur lors de l'enregistrement");
        setTimeout(() => setSaveError(""), 5000);
      }
    } catch {
      setSaveError("Erreur de connexion au serveur");
      setTimeout(() => setSaveError(""), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const dayLabels: { [key: string]: string } = {
    monday: "Lundi",
    tuesday: "Mardi",
    wednesday: "Mercredi",
    thursday: "Jeudi",
    friday: "Vendredi",
    saturday: "Samedi",
    sunday: "Dimanche",
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin text-[#C5A065]" size={40} />
      </div>
    );
  }

  const renderBusinessHours = (
    location: "businessHoursLaval" | "businessHoursMontreal",
    title: string,
    subtitle: string
  ) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <MapPin size={16} className="text-[#C5A065]" />
        <div>
          <h4 className="text-sm font-bold text-[#2D2A26]">{title}</h4>
          <p className="text-xs text-stone-500">{subtitle}</p>
        </div>
      </div>
      {Object.entries(settings[location]).map(([day, hours]) => (
        <div
          key={`${location}-${day}`}
          className="flex flex-col md:flex-row md:items-center gap-3 p-3 bg-stone-50 rounded-xl"
        >
          <div className="flex items-center gap-3 md:w-40">
            <input
              type="checkbox"
              checked={!hours.closed}
              onChange={(e) =>
                handleBusinessHoursChange(location, day, "closed", !e.target.checked)
              }
              className="w-4 h-4 rounded accent-[#C5A065]"
            />
            <span className="font-medium text-sm text-stone-700">
              {dayLabels[day]}
            </span>
          </div>

          {!hours.closed ? (
            <div className="flex items-center gap-3 flex-1">
              <input
                type="time"
                value={hours.open}
                onChange={(e) =>
                  handleBusinessHoursChange(location, day, "open", e.target.value)
                }
                className="p-2 bg-white border border-stone-200 rounded-lg focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm"
              />
              <span className="text-stone-400">à</span>
              <input
                type="time"
                value={hours.close}
                onChange={(e) =>
                  handleBusinessHoursChange(location, day, "close", e.target.value)
                }
                className="p-2 bg-white border border-stone-200 rounded-lg focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm"
              />
            </div>
          ) : (
            <span className="text-sm text-stone-400 italic">Fermé</span>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="h-full overflow-auto">
      <header className="p-4 md:p-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2
              className="text-4xl md:text-5xl mb-2"
              style={{ fontFamily: '"Great Vibes", cursive', color: "#C5A065" }}
            >
              Paramètres
            </h2>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
              Configuration de votre boutique
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 bg-[#C5A065] hover:bg-[#2D2A26] text-white px-6 py-3 rounded-xl transition-all duration-300 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {isSaving ? "Enregistrement..." : "Enregistrer tout"}
          </button>
        </div>
        {saveMessage && (
          <div className="mt-4 bg-green-100 border border-green-300 text-green-800 px-4 py-3 rounded-xl flex items-center gap-2">
            <AlertCircle size={18} />
            {saveMessage}
          </div>
        )}
        {saveError && (
          <div className="mt-4 bg-red-100 border border-red-300 text-red-800 px-4 py-3 rounded-xl flex items-center gap-2">
            <AlertCircle size={18} />
            {saveError}
          </div>
        )}
      </header>

      <div className="p-4 md:p-8 space-y-6">
        {/* General Information */}
        <div className="bg-white/70 backdrop-blur-md rounded-3xl shadow-xl border border-white p-6 md:p-8 hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-[#C5A065] bg-opacity-20 flex items-center justify-center">
              <Store size={20} className="text-[#C5A065]" />
            </div>
            <h3 className="text-xl md:text-2xl font-bold text-[#2D2A26]">
              Informations générales
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600 flex items-center gap-2">
                <Store size={14} />
                Nom de la boutique
              </label>
              <input
                type="text"
                value={settings.storeName}
                onChange={(e) => handleInputChange("storeName", e.target.value)}
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600 flex items-center gap-2">
                <Mail size={14} />
                Email de contact
              </label>
              <input
                type="email"
                value={settings.contactEmail}
                onChange={(e) => handleInputChange("contactEmail", e.target.value)}
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600 flex items-center gap-2">
                <Phone size={14} />
                Téléphone Laval
              </label>
              <input
                type="tel"
                value={settings.contactPhone}
                onChange={(e) => handleInputChange("contactPhone", e.target.value)}
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600 flex items-center gap-2">
                <Phone size={14} />
                Téléphone Montréal
              </label>
              <input
                type="tel"
                value={settings.contactPhoneMontreal}
                onChange={(e) => handleInputChange("contactPhoneMontreal", e.target.value)}
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600 flex items-center gap-2">
                <MapPin size={14} />
                Adresse Laval
              </label>
              <input
                type="text"
                value={settings.address}
                onChange={(e) => handleInputChange("address", e.target.value)}
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600 flex items-center gap-2">
                <MapPin size={14} />
                Adresse Montréal
              </label>
              <input
                type="text"
                value={settings.addressMontreal}
                onChange={(e) => handleInputChange("addressMontreal", e.target.value)}
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              />
            </div>
          </div>
        </div>

        {/* Business Hours */}
        <div className="bg-white/70 backdrop-blur-md rounded-3xl shadow-xl border border-white p-6 md:p-8 hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-[#C5A065] bg-opacity-20 flex items-center justify-center">
              <Clock size={20} className="text-[#C5A065]" />
            </div>
            <h3 className="text-xl md:text-2xl font-bold text-[#2D2A26]">
              Heures d'ouverture
            </h3>
          </div>

          <div className="space-y-8">
            {renderBusinessHours(
              "businessHoursLaval",
              "Laval",
              settings.address
            )}
            <hr className="border-stone-200" />
            {renderBusinessHours(
              "businessHoursMontreal",
              "Montréal",
              settings.addressMontreal
            )}
          </div>
        </div>

        {/* Email Notifications */}
        <div className="bg-white/70 backdrop-blur-md rounded-3xl shadow-xl border border-white p-6 md:p-8 hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-[#C5A065] bg-opacity-20 flex items-center justify-center">
              <Bell size={20} className="text-[#C5A065]" />
            </div>
            <h3 className="text-xl md:text-2xl font-bold text-[#2D2A26]">
              Notifications par email
            </h3>
          </div>

          <div className="space-y-3">
            <p className="text-sm text-stone-600 mb-4">
              Choisissez quand vous souhaitez recevoir des notifications par email
            </p>

            {[
              { field: "emailOnNewOrder" as const, label: "Nouvelle commande", desc: "Recevoir un email à chaque nouvelle commande" },
              { field: "emailOnOrderConfirmed" as const, label: "Commande confirmée", desc: "Notification quand une commande est confirmée" },
              { field: "emailOnPaymentReceived" as const, label: "Paiement reçu", desc: "Notification quand un paiement est reçu" },
              { field: "emailOnOrderReady" as const, label: "Commande prête", desc: "Notification quand une commande est prête pour le retrait" },
            ].map(({ field, label, desc }) => (
              <label
                key={field}
                className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl cursor-pointer hover:bg-stone-100 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={settings[field]}
                  onChange={(e) => handleInputChange(field, e.target.checked)}
                  className="w-4 h-4 rounded accent-[#C5A065]"
                />
                <div>
                  <div className="text-sm font-medium text-stone-700">{label}</div>
                  <div className="text-xs text-stone-500">{desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Closed Dates */}
        <div className="bg-white/70 backdrop-blur-md rounded-3xl shadow-xl border border-white p-6 md:p-8 hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-[#C5A065] bg-opacity-20 flex items-center justify-center">
              <CalendarOff size={20} className="text-[#C5A065]" />
            </div>
            <h3 className="text-xl md:text-2xl font-bold text-[#2D2A26]">
              Dates de fermeture
            </h3>
          </div>

          <p className="text-sm text-stone-600 mb-4">
            Les clients ne pourront pas commander pour ces dates. Format : jour et mois.
          </p>

          <div className="space-y-3">
            {settings.closedDates.map((dateStr, idx) => {
              const [mm, dd] = dateStr.split("-");
              const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
              const label = `${parseInt(dd)} ${monthNames[parseInt(mm) - 1] || mm}`;
              return (
                <div key={idx} className="flex items-center justify-between p-3 bg-stone-50 rounded-xl">
                  <span className="text-sm font-medium text-stone-700">{label}</span>
                  <button
                    onClick={() => {
                      const updated = settings.closedDates.filter((_, i) => i !== idx);
                      handleInputChange("closedDates", updated);
                    }}
                    className="text-stone-400 hover:text-red-500 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })}

            <div className="flex items-center gap-3 pt-2">
              <input
                type="date"
                id="new-closed-date"
                className="p-2 bg-stone-50 border border-stone-200 rounded-lg focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm"
              />
              <button
                onClick={() => {
                  const input = document.getElementById("new-closed-date") as HTMLInputElement;
                  if (!input.value) return;
                  const mmdd = input.value.slice(5); // "YYYY-MM-DD" -> "MM-DD"
                  if (!settings.closedDates.includes(mmdd)) {
                    handleInputChange("closedDates", [...settings.closedDates, mmdd]);
                  }
                  input.value = "";
                }}
                className="flex items-center gap-2 px-4 py-2 bg-[#C5A065] hover:bg-[#2D2A26] text-white rounded-lg transition-colors text-sm font-medium"
              >
                <Plus size={16} />
                Ajouter
              </button>
            </div>
          </div>
        </div>

        {/* Social Media */}
        <div className="bg-white/70 backdrop-blur-md rounded-3xl shadow-xl border border-white p-6 md:p-8 hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-[#C5A065] bg-opacity-20 flex items-center justify-center">
              <Globe size={20} className="text-[#C5A065]" />
            </div>
            <h3 className="text-xl md:text-2xl font-bold text-[#2D2A26]">
              Réseaux sociaux
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600 flex items-center gap-2">
                <Facebook size={14} />
                Facebook
              </label>
              <input
                type="url"
                value={settings.facebookUrl}
                onChange={(e) => handleInputChange("facebookUrl", e.target.value)}
                placeholder="https://facebook.com/votreboutique"
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600 flex items-center gap-2">
                <Instagram size={14} />
                Instagram
              </label>
              <input
                type="url"
                value={settings.instagramUrl}
                onChange={(e) => handleInputChange("instagramUrl", e.target.value)}
                placeholder="https://instagram.com/votreboutique"
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600 flex items-center gap-2">
                <Twitter size={14} />
                Twitter / X
              </label>
              <input
                type="url"
                value={settings.twitterUrl}
                onChange={(e) => handleInputChange("twitterUrl", e.target.value)}
                placeholder="https://twitter.com/votreboutique"
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              />
            </div>
          </div>
        </div>

        {/* Save Button (Bottom) */}
        <div className="flex justify-center pt-4">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 bg-[#C5A065] hover:bg-[#2D2A26] text-white px-8 py-4 rounded-xl transition-all duration-300 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed text-lg font-semibold"
          >
            {isSaving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
            {isSaving ? "Enregistrement en cours..." : "Enregistrer tous les paramètres"}
          </button>
        </div>
      </div>
    </div>
  );
}
