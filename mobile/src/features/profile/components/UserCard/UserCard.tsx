import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { BadgeCheck, CircleAlert, RefreshCw } from 'lucide-react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Skeleton } from '@/components/Skeleton';
import type { User } from '@/features/auth';
import { initials } from '@/lib/format';
import { INSET_SURFACE, LABEL_TEXT, SECONDARY_LABEL_TEXT } from '@/lib/screen';
import { useColors } from '@/lib/theme';

import { ProfileCard } from '../ProfileCard';

/**
 * Who is signed in (ported from rooler `HeaderSection`): a 48px tile with the
 * initials, the name and the email beside it, and whether the email is
 * verified. No avatar upload: our backend has no avatars.
 */
export function UserCard({ user, footer }: { user: User; footer?: React.ReactNode }) {
  const { t } = useTranslation();
  const c = useColors();
  const verified = user.email_verified === true;

  return (
    <ProfileCard>
      <View className="flex-row items-center gap-2">
        <View className={`h-12 w-12 items-center justify-center rounded-[16px] ${INSET_SURFACE}`}>
          <Text className={`text-base font-semibold ${LABEL_TEXT}`}>
            {initials(user.name || user.email)}
          </Text>
        </View>

        <View className="flex-1">
          <Text numberOfLines={1} className={`text-base font-semibold leading-6 ${LABEL_TEXT}`}>
            {user.name || '—'}
          </Text>
          <Text numberOfLines={1} className={`text-sm leading-[18px] ${SECONDARY_LABEL_TEXT}`}>
            {user.email || '—'}
          </Text>
        </View>

        <View
          className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
          style={{ backgroundColor: verified ? c.successBg : c.inputBg }}
        >
          {verified ? (
            <BadgeCheck size={14} color={c.success} />
          ) : (
            <CircleAlert size={14} color={c.muted} />
          )}
          <Text className="text-xs font-semibold" style={{ color: verified ? c.success : c.muted }}>
            {verified ? t('profile.verified') : t('profile.notVerified')}
          </Text>
        </View>
      </View>
      {footer}
    </ProfileCard>
  );
}

/** The user card's shape while the user loads. */
export function UserCardSkeleton() {
  return (
    <ProfileCard>
      <View className="flex-row items-center gap-2">
        <Skeleton width={48} height={48} radius={16} />
        <View className="flex-1 gap-2">
          <Skeleton width="55%" height={16} radius={8} />
          <Skeleton width="75%" height={12} />
        </View>
      </View>
    </ProfileCard>
  );
}

/**
 * The user card when the user couldn't load. Only this card fails: the
 * preferences and sign-out below don't depend on it.
 */
export function UserCardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <ProfileCard>
      <View className="items-center gap-1 py-2">
        <Text className={`text-base font-semibold ${LABEL_TEXT}`}>{t('states.errorTitle')}</Text>
        <Text className={`text-center text-sm ${SECONDARY_LABEL_TEXT}`}>{message}</Text>
        <PrimaryButton
          label={t('common.retry')}
          icon={RefreshCw}
          size="xs"
          className="mt-3 min-w-[140px]"
          onPress={onRetry}
        />
      </View>
    </ProfileCard>
  );
}
