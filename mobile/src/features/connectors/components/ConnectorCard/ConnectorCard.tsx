import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { Skeleton } from '@/components/Skeleton';
import { CARD_SURFACE, LABEL_TEXT, TERTIARY_LABEL_TEXT, useCardShadow } from '@/lib/screen';

export interface ConnectorCardProps {
  /** Brand name. */
  name: string;
  icon: LucideIcon;
  /** Brand colour of the logo tile. */
  tint: string;
  connected: boolean;
  /** What connecting gives — shown while not connected. */
  description?: string;
  /** Who is connected — shown while connected. Empty lines are skipped. */
  account?: { title: string; lines?: (string | null | undefined)[] };
  /** Connect / open / disconnect buttons. */
  children?: ReactNode;
}

/** One integration on the Connectors tab: logo, name, status pill, account, actions. */
export function ConnectorCard({
  name,
  icon: Icon,
  tint,
  connected,
  description,
  account,
  children,
}: ConnectorCardProps) {
  const { t } = useTranslation();
  const shadow = useCardShadow();
  const lines = (account?.lines ?? []).filter((line): line is string => !!line);

  return (
    <View className={`${CARD_SURFACE} p-4`} style={shadow}>
      <View className="mb-3 flex-row items-center">
        <View
          className="mr-2.5 h-9 w-9 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: tint }}
        >
          <Icon size={20} color="#fff" />
        </View>
        <Text className={`flex-1 text-lg font-bold ${LABEL_TEXT}`}>{name}</Text>
        <View
          className={`rounded-full px-2.5 py-1 ${
            connected ? 'bg-green-500/15' : 'bg-zinc-100 dark:bg-zinc-800'
          }`}
        >
          <Text
            className={`text-xs font-semibold ${
              connected ? 'text-green-600 dark:text-green-400' : TERTIARY_LABEL_TEXT
            }`}
          >
            {connected ? t('connectors.connected') : t('connectors.notConnected')}
          </Text>
        </View>
      </View>

      {account ? (
        <View className="mb-3.5">
          <Text className={`text-base font-semibold ${LABEL_TEXT}`}>{account.title}</Text>
          {lines.map((line) => (
            <Text key={line} className={`mt-0.5 text-sm ${TERTIARY_LABEL_TEXT}`}>
              {line}
            </Text>
          ))}
        </View>
      ) : description ? (
        <Text className={`mb-3.5 text-sm ${TERTIARY_LABEL_TEXT}`}>{description}</Text>
      ) : null}

      {children}
    </View>
  );
}

/** Loading placeholder in the shape of connector cards. */
export function ConnectorCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View className="gap-4 p-4" accessibilityRole="progressbar" accessibilityState={{ busy: true }}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} className={`${CARD_SURFACE} p-4`}>
          <View className="mb-4 flex-row items-center">
            <Skeleton width={36} height={36} radius={10} />
            <Skeleton width="40%" height={16} style={{ marginLeft: 10 }} />
          </View>
          <Skeleton width="85%" />
          <Skeleton width="60%" style={{ marginTop: 8 }} />
          <Skeleton height={44} radius={16} style={{ marginTop: 16 }} />
        </View>
      ))}
    </View>
  );
}
