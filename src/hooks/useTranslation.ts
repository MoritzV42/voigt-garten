import { useState, useEffect, useCallback, createContext, useContext } from 'react';

type Lang = 'de' | 'en';

const API_URL = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';
const LANG_KEY = 'voigt-garten-lang';

interface TranslationContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (text: string) => string;
  isLoading: boolean;
}

// Global translation cache (shared across all hook instances)
const translationCache: Record<string, string> = {};
let cacheLoaded = false;
let cacheLoadPromise: Promise<void> | null = null;

// Pending translations queue
let pendingTexts: Set<string> = new Set();
let batchTimeout: ReturnType<typeof setTimeout> | null = null;
let batchResolvers: Array<() => void> = [];

function getStoredLang(): Lang {
  if (typeof window === 'undefined') return 'de';
  return (localStorage.getItem(LANG_KEY) as Lang) || 'de';
}

async function loadCachedTranslations(): Promise<void> {
  if (cacheLoaded) return;
  if (cacheLoadPromise) return cacheLoadPromise;

  cacheLoadPromise = fetch(`${API_URL}/api/translations/preload?lang=en`)
    .then(res => res.json())
    .then(data => {
      if (data.translations) {
        Object.assign(translationCache, data.translations);
      }
      cacheLoaded = true;
    })
    .catch(() => {
      cacheLoaded = true; // Don't retry on error
    });

  return cacheLoadPromise;
}

async function translateBatch(texts: string[]): Promise<void> {
  if (texts.length === 0) return;

  try {
    const res = await fetch(`${API_URL}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, target_lang: 'en' }),
    });
    const data = await res.json();
    if (data.translations) {
      Object.assign(translationCache, data.translations);
    }
  } catch {
    // Silently fail — show original text
  }
}

function queueTranslation(text: string): void {
  if (translationCache[text] !== undefined) return;
  pendingTexts.add(text);

  if (batchTimeout) clearTimeout(batchTimeout);
  batchTimeout = setTimeout(async () => {
    const batch = Array.from(pendingTexts);
    pendingTexts = new Set();
    const resolvers = [...batchResolvers];
    batchResolvers = [];

    await translateBatch(batch);
    resolvers.forEach(r => r());
  }, 50); // 50ms debounce to batch translations
}

// Global language state with listeners
let globalLang: Lang = getStoredLang();
const langListeners: Set<(lang: Lang) => void> = new Set();

function setGlobalLang(lang: Lang) {
  globalLang = lang;
  if (typeof window !== 'undefined') {
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;
  }
  langListeners.forEach(fn => fn(lang));
}

export function useTranslation() {
  const [lang, setLangState] = useState<Lang>(globalLang);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = (newLang: Lang) => {
      setLangState(newLang);
    };
    langListeners.add(listener);
    return () => { langListeners.delete(listener); };
  }, []);

  // Preload cache when switching to English
  useEffect(() => {
    if (lang === 'en' && !cacheLoaded) {
      loadCachedTranslations().then(() => {
        forceUpdate(n => n + 1);
      });
    }
  }, [lang]);

  const setLang = useCallback((newLang: Lang) => {
    setGlobalLang(newLang);
  }, []);

  const t = useCallback((text: string): string => {
    if (lang === 'de') return text;

    // Check cache
    if (translationCache[text] !== undefined) {
      return translationCache[text];
    }

    // Queue for translation, return original for now
    queueTranslation(text);

    // Schedule a re-render after batch completes
    const promise = new Promise<void>(resolve => {
      batchResolvers.push(resolve);
    });
    promise.then(() => {
      forceUpdate(n => n + 1);
    });

    return text; // Show German until translation arrives
  }, [lang]);

  return { lang, setLang, t, isLoading: lang === 'en' && !cacheLoaded };
}

// Context for sharing translation state across component tree
const TranslationContext = createContext<TranslationContextType | null>(null);

export const TranslationProvider = TranslationContext.Provider;

export function useTranslationContext() {
  const ctx = useContext(TranslationContext);
  if (!ctx) {
    // Fallback: use hook directly if no provider
    return useTranslation();
  }
  return ctx;
}
