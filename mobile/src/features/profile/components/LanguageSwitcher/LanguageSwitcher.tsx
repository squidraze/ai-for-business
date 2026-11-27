import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react-native';

import { PickerSheet } from '@/components/PickerSheet';
import { LANGUAGES, setLanguage, type Language } from '@/lib/i18n';

import { ProfileRow } from '../ProfileRow';

function isLanguage(id: string | undefined): id is Language {
  return !!id && (LANGUAGES as readonly string[]).includes(id);
}

/**
 * Which language the app is shown in, as a row of the preferences card, with a
 * `PickerSheet` to change it (ported from rooler `LanguageSwitcher`). Each
 * language is listed in itself (`languages.*` holds native names).
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  // Read from the hook's i18n so the row re-renders after a switch.
  const language: Language = isLanguage(i18n.language) ? i18n.language : 'en';

  // The pick is applied once the sheet has slid out: a language switch
  // re-renders every translated screen, and doing that mid-animation stutters.
  const pending = useRef<Language | null>(null);
  const handleClose = useCallback(() => {
    setIsOpen(false);
    const next = pending.current;
    pending.current = null;
    if (next && next !== language) void setLanguage(next);
  }, [language]);

  return (
    <>
      <ProfileRow
        icon={Languages}
        label={t('profile.language')}
        subtitle={t(`languages.${language}`)}
        onPress={() => setIsOpen(true)}
      />
      <PickerSheet
        isOpen={isOpen}
        onClose={handleClose}
        title={t('profile.language')}
        options={LANGUAGES.map((code) => ({ id: code, label: t(`languages.${code}`) }))}
        selectedId={language}
        onSelect={(id) => {
          if (isLanguage(id)) pending.current = id;
        }}
      />
    </>
  );
}
