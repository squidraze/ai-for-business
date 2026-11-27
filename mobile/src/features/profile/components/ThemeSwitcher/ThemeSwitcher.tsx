import { Moon, Sun } from 'lucide-react-native';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PickerSheet } from '@/components/PickerSheet';
import { setThemeMode, THEME_MODES, useThemeMode, type ThemeMode } from '@/lib/themeMode';
import { useColors } from '@/lib/theme';

import { ProfileRow } from '../ProfileRow';

const LABEL_KEYS: Record<ThemeMode, string> = {
  system: 'profile.themeSystem',
  dark: 'profile.themeDark',
  light: 'profile.themeLight',
};

function isThemeMode(id: string | undefined): id is ThemeMode {
  return !!id && (THEME_MODES as readonly string[]).includes(id);
}

/**
 * The theme row of the preferences card plus its picker (ported from rooler
 * `ThemeSection`): system / dark / light. The icon shows the scheme actually
 * active, the subtitle the picked mode.
 */
export function ThemeSwitcher() {
  const { t } = useTranslation();
  const c = useColors();
  const themeMode = useThemeMode();
  const [isOpen, setIsOpen] = useState(false);

  // The pick is applied once the sheet has slid out: re-theming every screen
  // under an open sheet stutters its close animation.
  const pending = useRef<ThemeMode | null>(null);
  const handleClose = useCallback(() => {
    setIsOpen(false);
    const next = pending.current;
    pending.current = null;
    if (next && next !== themeMode) void setThemeMode(next);
  }, [themeMode]);

  return (
    <>
      <ProfileRow
        icon={c.scheme === 'dark' ? Moon : Sun}
        label={t('profile.theme')}
        subtitle={t(LABEL_KEYS[themeMode])}
        onPress={() => setIsOpen(true)}
      />
      <PickerSheet
        isOpen={isOpen}
        onClose={handleClose}
        title={t('profile.theme')}
        options={THEME_MODES.map((mode) => ({ id: mode, label: t(LABEL_KEYS[mode]) }))}
        selectedId={themeMode}
        onSelect={(id) => {
          if (isThemeMode(id)) pending.current = id;
        }}
      />
    </>
  );
}
