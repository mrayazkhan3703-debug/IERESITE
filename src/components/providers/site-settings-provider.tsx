"use client";

import * as React from "react";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site-settings";

const SiteSettingsContext = React.createContext<SiteSettings>(DEFAULT_SITE_SETTINGS);

export function SiteSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = React.useState(DEFAULT_SITE_SETTINGS);
  React.useEffect(() => {
    let active = true;
    fetch("/api/site-settings", { headers: { accept: "application/json" } })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { settings?: SiteSettings } | null) => {
        if (active && data?.settings) setSettings(data.settings);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  return <SiteSettingsContext.Provider value={settings}>{children}</SiteSettingsContext.Provider>;
}

export function useSiteSettings() {
  return React.useContext(SiteSettingsContext);
}
