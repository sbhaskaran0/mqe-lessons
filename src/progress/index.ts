// The app's one progress store, and the hooks components read it with.
import { useSyncExternalStore } from "react";
import { createProgressStore, safeStorage, type ProgressData, type Settings, type Theme } from "./store";

export * from "./store";

export const progress = createProgressStore(
  safeStorage(() => (typeof window === "undefined" ? undefined : window.localStorage)),
);

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key.startsWith("mqe-lessons/")) progress.reload();
  });
}

export function useProgress(): ProgressData {
  return useSyncExternalStore(progress.subscribe, progress.get, progress.get);
}

export function useSettings(): Settings {
  return useSyncExternalStore(progress.subscribe, progress.settings, progress.settings);
}

/** html[data-theme] drives the token overrides in tokens.css; "system" leaves the OS preference in charge. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}
