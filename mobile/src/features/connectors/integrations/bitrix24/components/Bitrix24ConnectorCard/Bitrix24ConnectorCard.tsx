import { router } from 'expo-router';
import { Briefcase } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { errorMessage } from '@/lib/api';

import { ConnectedActions, ConnectorCard, WebhookField } from '../../../../components';
import { useDisconnect } from '../../../../connectors.hooks';
import type { ConnectorCardProps } from '../../../../types';
import { bitrixApi, type BitrixAccount } from '../../bitrix24.api';
import { useConnectBitrix } from '../../bitrix24.hooks';

export const BITRIX24_NAME = 'Bitrix24';
const TINT = '#2fc6f6';

/** Bitrix24 on the Connectors tab; connects with a pasted inbound webhook URL. */
export function Bitrix24ConnectorCard({ status }: ConnectorCardProps) {
  const { t } = useTranslation();
  const disconnect = useDisconnect({ name: BITRIX24_NAME, disconnect: bitrixApi.disconnect });
  const connectBitrix = useConnectBitrix();
  const [webhookUrl, setWebhookUrl] = useState('');
  const connected = !!status?.connected;
  const account = (status?.account ?? null) as BitrixAccount | null;

  const submit = () => {
    const url = webhookUrl.trim();
    if (!url || connectBitrix.isPending) return;
    connectBitrix.mutate(url, {
      onSuccess: () => setWebhookUrl(''),
      onError: (e) => Alert.alert(BITRIX24_NAME, errorMessage(e, t('bitrix.card.connectFailed'))),
    });
  };

  return (
    <ConnectorCard
      name={BITRIX24_NAME}
      icon={Briefcase}
      tint={TINT}
      connected={connected}
      description={t('bitrix.card.description')}
      account={
        connected
          ? { title: account?.portal || t('bitrix.card.account'), lines: [account?.user_name] }
          : undefined
      }
    >
      {connected ? (
        <ConnectedActions
          openLabel={t('bitrix.card.open')}
          openIcon={Briefcase}
          onOpen={() => router.push('/bitrix')}
          onDisconnect={disconnect.confirm}
          disconnecting={disconnect.isPending}
        />
      ) : (
        <WebhookField
          steps={[t('bitrix.card.step1'), t('bitrix.card.step2'), t('bitrix.card.step3')]}
          value={webhookUrl}
          onChangeText={setWebhookUrl}
          onSubmit={submit}
          loading={connectBitrix.isPending}
          placeholder={t('bitrix.card.webhookPlaceholder')}
        />
      )}
    </ConnectorCard>
  );
}
