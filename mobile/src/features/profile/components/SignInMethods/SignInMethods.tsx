import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { KeyRound, Mail } from 'lucide-react-native';

import type { AuthProviderId } from '@/features/auth';
import { TERTIARY_LABEL_TEXT } from '@/lib/screen';

import { ProfileCardSection } from '../ProfileCard';
import { ProfileRow, type RowIcon } from '../ProfileRow';

// Lucide has no brand logos, so Google and Apple come from Ionicons, wrapped
// to the same `size` / `color` shape as a Lucide glyph.
const GoogleGlyph: RowIcon = ({ size, color }) => (
  <Ionicons name="logo-google" size={size} color={color} />
);
const AppleGlyph: RowIcon = ({ size, color }) => (
  <Ionicons name="logo-apple" size={size} color={color} />
);

const PROVIDER_ICONS: Record<AuthProviderId, RowIcon> = {
  password: Mail,
  google: GoogleGlyph,
  apple: AppleGlyph,
};

/**
 * How this account signs in, as the lower part of the user card. Renders
 * nothing when the backend sent no providers, so no stray hairline is left.
 */
export function SignInMethods({ providers }: { providers: unknown }) {
  const { t } = useTranslation();
  const list = Array.isArray(providers) ? (providers as AuthProviderId[]) : [];
  if (list.length === 0) return null;

  return (
    <ProfileCardSection>
      <Text className={`pb-2 text-xs font-medium uppercase ${TERTIARY_LABEL_TEXT}`}>
        {t('profile.signInMethods')}
      </Text>
      {/* Spaced, without hairlines: the section already has one above. */}
      <View className="gap-2">
        {list.map((provider) => (
          <ProfileRow
            key={provider}
            icon={PROVIDER_ICONS[provider] ?? KeyRound}
            label={t(`profile.providers.${provider}`, { defaultValue: String(provider) })}
          />
        ))}
      </View>
    </ProfileCardSection>
  );
}
