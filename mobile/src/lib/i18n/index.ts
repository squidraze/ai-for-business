import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ru from './locales/ru.json';
import uz from './locales/uz.json';

export const LANGUAGES = ['en', 'ru', 'uz'] as const;
export type Language = (typeof LANGUAGES)[number];

const LANGUAGE_KEY = 'forbusiness_language';

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Device language if we support it, otherwise English. */
function deviceLanguage(): Language {
  try {
    const code = getLocales()[0]?.languageCode?.toLowerCase();
    return isLanguage(code) ? code : 'en';
  } catch {
    return 'en';
  }
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ru: { translation: ru }, uz: { translation: uz } },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  supportedLngs: [...LANGUAGES],
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
});

// A language picked in Profile wins over the device language.
void (async () => {
  try {
    const saved = await SecureStore.getItemAsync(LANGUAGE_KEY);
    if (isLanguage(saved) && saved !== i18n.language) await i18n.changeLanguage(saved);
  } catch {
    // keep the device language
  }
})();

export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : 'en';
}

export async function setLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language);
  try {
    await SecureStore.setItemAsync(LANGUAGE_KEY, language);
  } catch {
    // the choice still applies for this session
  }
}

export default i18n;
