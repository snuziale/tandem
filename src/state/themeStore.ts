import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "future-light" | "future-dark";
export type ThemePreference = "light" | "dark" | "system";

type ThemeState = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  cyclePreference: () => void;
};

const CYCLE: Record<ThemePreference, ThemePreference> = {
  light: "dark",
  dark: "system",
  system: "light",
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: "system",
      setPreference: (preference) => set({ preference }),
      cyclePreference: () => set((s) => ({ preference: CYCLE[s.preference] })),
    }),
    { name: "tandem:theme:v1", version: 1 },
  ),
);

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(preference: ThemePreference): Theme {
  if (preference === "system")
    return systemPrefersDark() ? "future-dark" : "future-light";
  return preference === "dark" ? "future-dark" : "future-light";
}

const THEME_CLASSES: Theme[] = ["future-light", "future-dark"];

export function applyThemeClass(theme: Theme) {
  const body = document.body;
  for (const cls of THEME_CLASSES) {
    body.classList.toggle(cls, cls === theme);
  }
}
