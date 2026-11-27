import { router } from 'expo-router';
import { MessagesSquare, Send } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '@/components/PrimaryButton';
import { formatPhone, joinParts } from '@/lib/format';

import { ConnectedActions, ConnectorCard } from '../../../../components';
import { useDisconnect } from '../../../../connectors.hooks';
import type { ConnectorCardProps } from '../../../../types';
import { telegramApi, type TelegramAccount } from '../../telegram.api';

export const TELEGRAM_NAME = 'Telegram';
const TINT = '#29a9eb';

/** Telegram on the Connectors tab. */
export function TelegramConnectorCard({ status }: ConnectorCardProps) {
  const { t } = useTranslation();
  const disconnect = useDisconnect({ name: TELEGRAM_NAME, disconnect: telegramApi.logout });
  const connected = !!status?.connected;
  const account = (status?.account ?? null) as TelegramAccount | null;
  const username = typeof account?.username === 'string' && account.username ? `@${account.username}` : null;

  return (
    <ConnectorCard
      name={TELEGRAM_NAME}
      icon={Send}
      tint={TINT}
      connected={connected}
      description={t('telegram.card.description')}
      account={
        connected
          ? {
              title: joinParts([account?.first_name, account?.last_name]) || t('telegram.card.account'),
              lines: [username, formatPhone(account?.phone)],
            }
          : undefined
      }
    >
      {connected ? (
        <ConnectedActions
          openLabel={t('telegram.card.open')}
          openIcon={MessagesSquare}
          onOpen={() => router.push('/telegram')}
          onDisconnect={disconnect.confirm}
          disconnecting={disconnect.isPending}
        />
      ) : (
        <PrimaryButton size="md" label={t('telegram.card.connect')} onPress={() => router.push('/telegram/connect')} />
      )}
    </ConnectorCard>
  );
}
