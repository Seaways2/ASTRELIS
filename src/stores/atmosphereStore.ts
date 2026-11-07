import { create } from "zustand";
import { normalizeAtmosphere, type AtmosphereSettings } from "../utils/atmosphere";
const key = "astrelis.appearance.atmosphere.v1";
const read = () => {
  try {
    const raw = localStorage.getItem(key);
    const settings = normalizeAtmosphere(JSON.parse(raw || "null"));
    if (raw && raw !== JSON.stringify(settings)) {
      try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Keep migrated values in memory. */ }
    }
    return settings;
  }
  catch { return normalizeAtmosphere(null); }
};
interface AtmosphereState {
  settings: AtmosphereSettings;
  update(patch: Partial<AtmosphereSettings>): void;
}
export const useAtmosphereStore = create<AtmosphereState>((set, get) => {
  const save = (settings: AtmosphereSettings) => {
    try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Keep controls usable if storage is unavailable. */ }
    set({ settings });
  };
  return {
    settings: read(),
    update: patch => save(normalizeAtmosphere({ ...get().settings, ...patch }))
  };
});
