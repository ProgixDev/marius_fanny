import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
const normalizedApiUrl = API_URL.startsWith("http") ? API_URL : `https://${API_URL}`;

interface BusinessHours {
  [key: string]: { open: string; close: string; closed: boolean };
}

export interface SiteSettings {
  storeName: string;
  contactEmail: string;
  contactPhone: string;
  contactPhoneMontreal: string;
  address: string;
  addressMontreal: string;
  businessHoursLaval: BusinessHours;
  businessHoursMontreal: BusinessHours;
  closedDates: string[];
  facebookUrl: string;
  instagramUrl: string;
  twitterUrl: string;
}

const defaultSettings: SiteSettings = {
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
  closedDates: ["01-01", "12-25"],
  facebookUrl: "https://www.facebook.com/mariusetfanny/",
  instagramUrl: "https://www.instagram.com/patisseriemariusetfanny/",
  twitterUrl: "",
};

function parseSettings(d: any): SiteSettings {
  return {
    storeName: d.storeName ?? defaultSettings.storeName,
    contactEmail: d.contactEmail ?? defaultSettings.contactEmail,
    contactPhone: d.contactPhone ?? defaultSettings.contactPhone,
    contactPhoneMontreal: d.contactPhoneMontreal ?? defaultSettings.contactPhoneMontreal,
    address: d.address ?? defaultSettings.address,
    addressMontreal: d.addressMontreal ?? defaultSettings.addressMontreal,
    businessHoursLaval: d.businessHoursLaval ?? defaultSettings.businessHoursLaval,
    businessHoursMontreal: d.businessHoursMontreal ?? defaultSettings.businessHoursMontreal,
    closedDates: d.closedDates ?? defaultSettings.closedDates,
    facebookUrl: d.facebookUrl ?? defaultSettings.facebookUrl,
    instagramUrl: d.instagramUrl ?? defaultSettings.instagramUrl,
    twitterUrl: d.twitterUrl ?? defaultSettings.twitterUrl,
  };
}

interface SettingsContextValue {
  settings: SiteSettings;
  refreshSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: defaultSettings,
  refreshSettings: async () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SiteSettings>(defaultSettings);

  const refreshSettings = useCallback(async () => {
    try {
      const res = await fetch(`${normalizedApiUrl}/api/settings`);
      const json = await res.json();
      if (json.success && json.data) {
        setSettings(parseSettings(json.data));
      }
    } catch {
      // keep current settings on error
    }
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  return (
    <SettingsContext.Provider value={{ settings, refreshSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext).settings;
}

export function useRefreshSettings() {
  return useContext(SettingsContext).refreshSettings;
}
