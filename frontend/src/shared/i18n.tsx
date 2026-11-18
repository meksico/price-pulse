import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en, type TranslationDict } from "./locales/en";
import { uk } from "./locales/uk";

export type AppLanguage = "en" | "uk";

export const LANG_STORAGE_KEY = "pricepulse_lang";

const LOCALES: Record<AppLanguage, TranslationDict> = {
  en,
  uk,
};

type NestedKeys<T> = {
  [K in keyof T & string]: T[K] extends Record<string, string>
    ? `${K}.${keyof T[K] & string}`
    : K;
}[keyof T & string];

type TopSection = keyof TranslationDict & string;
export type TranslationKey = {
  [S in TopSection]: `${S}.${NestedKeys<TranslationDict[S]>}`;
}[TopSection];

function isAppLanguage(value: string | null): value is AppLanguage {
  return value === "en" || value === "uk";
}

export function getStoredLanguage(): AppLanguage {
  try {
    const raw = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (isAppLanguage(raw)) return raw;
  } catch {
    // Ignore storage access errors in restricted contexts.
  }
  return "en";
}

export function saveStoredLanguage(lang: AppLanguage): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Ignore storage access errors.
  }
}

export function pluralUk(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  const abs = Math.abs(count);
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function resolveKey(dict: TranslationDict, key: string): string {
  const parts = key.split(".");
  let current: unknown = dict;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof current === "string" ? current : key;
}

export type TranslateFn = (
  key: TranslationKey,
  vars?: Record<string, string | number>,
) => string;

interface I18nContextValue {
  lang: AppLanguage;
  locale: string;
  setLang: (lang: AppLanguage) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<AppLanguage>(() => getStoredLanguage());

  const setLang = useCallback((next: AppLanguage) => {
    setLangState(next);
    saveStoredLanguage(next);
  }, []);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === LANG_STORAGE_KEY && isAppLanguage(e.newValue)) {
        setLangState(e.newValue);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = LOCALES[lang].app.title;
  }, [lang]);

  const t = useCallback<TranslateFn>(
    (key, vars) => {
      let template = resolveKey(LOCALES[lang], key);
      if (vars) {
        for (const [varKey, varVal] of Object.entries(vars)) {
          template = template.replaceAll(`{${varKey}}`, String(varVal));
        }
      }
      return template;
    },
    [lang],
  );

  const locale = lang === "uk" ? "uk-UA" : "en-US";

  const value = useMemo<I18nContextValue>(
    () => ({ lang, locale, setLang, t }),
    [lang, locale, setLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
