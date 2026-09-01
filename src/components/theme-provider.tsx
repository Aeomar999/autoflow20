"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * Theme provider.
 *
 * Hand-rolled rather than `next-themes`, which renders its no-flash script as
 * a sibling of `children` inside the provider. That extra server-only node
 * shifts every `useId` below it, so every form on the site hydrated with
 * mismatched `id` / `htmlFor` / `aria-describedby` attributes. This provider
 * renders nothing but its children; the no-flash script is emitted once by the
 * root layout, outside the id scope (see `ThemeScript`).
 */

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "autoflow-theme";
const DEFAULT_THEME: Theme = "dark";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  resolvedTheme: "dark",
  setTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

const prefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

const resolve = (theme: Theme): ResolvedTheme =>
  theme === "system" ? (prefersDark() ? "dark" : "light") : theme;

const apply = (resolved: ResolvedTheme) => {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
};

/**
 * Runs before first paint so the stored theme is on `<html>` by the time the
 * page renders. Kept in sync with the constants above by hand: it cannot
 * import them, because it is a string executed outside the bundle.
 */
export const ThemeScript = () => (
  <script
    // biome-ignore lint/security/noDangerouslySetInnerHtml: no-flash theme script
    dangerouslySetInnerHTML={{
      __html: `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}")||"${DEFAULT_THEME}";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";}catch(e){}})();`,
    }}
  />
);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  // The server cannot read localStorage, so the first render always assumes
  // the default. `ThemeScript` has already put the real class on <html>, and
  // the effect below reconciles React's copy of it on mount.
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(
    DEFAULT_THEME === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    let stored: Theme | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    } catch {
      // Private mode or blocked storage: fall back to the default.
    }

    const next = stored ?? DEFAULT_THEME;
    setThemeState(next);
    const nextResolved = resolve(next);
    setResolvedTheme(nextResolved);
    apply(nextResolved);
  }, []);

  // Only "system" follows the OS, and only while it is selected.
  useEffect(() => {
    if (theme !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = media.matches ? "dark" : "light";
      setResolvedTheme(next);
      apply(next);
    };

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preference is not persisted; the current session still switches.
    }
    const nextResolved = resolve(next);
    setResolvedTheme(nextResolved);
    apply(nextResolved);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};
