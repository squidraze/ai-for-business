import i18next from 'i18next';
import { initReactI18next, useTranslation as useI18nextTranslation } from 'react-i18next';

import { on } from '@/bridge/bridge';

import en from './locales/en.json';
import ru from './locales/ru.json';
import uz from './locales/uz.json';

/**
 * The page's UI language. The host owns the choice (Profile → Language in the
 * app, falling back to the phone's language) and hands it over as an `Intl`
 * locale: once in `init.locale`, then as `locale.set` whenever it changes while
 * the chat is open. The page never detects a language of its own — a WebView's
 * `navigator.language` is the phone's, which is exactly what a user who picked
 * another language in the app does not want.
 *
 * English is the reference: every key is written in `en.json` first, and a key
 * missing from `ru` / `uz` falls back to it. Bundles are imported JSON, so the
 * first frame is already in the right language — no async load, no flash.
 *
 * Inside React: `const { t } = useTranslation()`. Outside React: `t(...)` from
 * here, called when the text is needed — never in a module-level constant,
 * which would freeze whatever language was active at import.
 */

export type Language = 'en' | 'ru' | 'uz';

const LANGUAGES: readonly Language[] = ['en', 'ru', 'uz'];

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: LANGUAGES,
  ns: ['chat'],
  defaultNS: 'chat',
  resources: { en: { chat: en }, ru: { chat: ru }, uz: { chat: uz } },
  initAsync: false,
  compatibilityJSON: 'v4',
  // React escapes on its own; i18next's escaping would print `&amp;`.
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
});

/** `ru-RU` → `ru`, `uz-Latn-UZ` → `uz`; anything this page has no strings for → `en`. */
export function languageFromLocale(locale: string | null | undefined): Language {
  const base = (locale ?? '').split(/[-_]/)[0]?.toLowerCase();
  return (LANGUAGES as readonly string[]).includes(base) ? (base as Language) : 'en';
}

let hostLocale: string | null = null;

/** The `Intl` locale the host sent — what dates and numbers are formatted in. */
export function getHostLocale(): string {
  return hostLocale ?? 'en-US';
}

export function applyLocale(locale: string | null | undefined): void {
  if (!locale) return;
  hostLocale = locale;
  const language = languageFromLocale(locale);
  document.documentElement.lang = language;
  if (i18n.language !== language) void i18n.changeLanguage(language);
}

let subscribed = false;

/**
 * Subscribed BEFORE `ready` is posted, like the theme, so a `locale.set` the
 * host fires while the page still waits for `init` is not dropped. Idempotent.
 */
export function startLocaleBridge(): void {
  if (subscribed) return;
  subscribed = true;
  on('init', (payload) => applyLocale(payload.locale));
  on('locale.set', (payload) => applyLocale(payload.locale));
}

export const t = i18n.t.bind(i18n);

export function useTranslation() {
  return useI18nextTranslation('chat', { i18n });
}
