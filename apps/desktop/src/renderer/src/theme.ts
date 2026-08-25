export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

const storageKey = "nedia-matrix.theme";

export function loadThemePreference(): ThemePreference {
  const stored = globalThis.localStorage.getItem(storageKey);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function saveThemePreference(preference: ThemePreference): void {
  if (preference === "system") globalThis.localStorage.removeItem(storageKey);
  else globalThis.localStorage.setItem(storageKey, preference);
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  return preference === "system"
    ? systemPrefersDark
      ? "dark"
      : "light"
    : preference;
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
}
