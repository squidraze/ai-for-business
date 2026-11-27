import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Mail, MailOpen } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { errorMessage } from '@/lib/api';

import { ConnectedActions, ConnectorCard } from '../../../../components';
import { invalidateConnectors, useDisconnect } from '../../../../connectors.hooks';
import type { ConnectorCardProps } from '../../../../types';
import { gmailApi, type GmailAccount } from '../../gmail.api';

export const GMAIL_NAME = 'Gmail';
const TINT = '#ea4335';
/** Google OAuth returns here (the Connectors tab); the tab re-reads the status. */
const GMAIL_REDIRECT = 'forbusiness://connectors';

/** Gmail on the Connectors tab; connects through Google OAuth in the browser. */
export function GmailConnectorCard({ status }: ConnectorCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const disconnect = useDisconnect({ name: GMAIL_NAME, disconnect: gmailApi.disconnect });
  const [busy, setBusy] = useState(false);
  const connected = !!status?.connected;
  const email = (status?.account as GmailAccount | null)?.email;

  const connect = async () => {
    setBusy(true);
    try {
      const url = await gmailApi.authUrl();
      await WebBrowser.openAuthSessionAsync(url, GMAIL_REDIRECT);
    } catch (e) {
      Alert.alert(GMAIL_NAME, errorMessage(e, t('gmail.card.signInFailed')));
    } finally {
      setBusy(false);
      void invalidateConnectors(queryClient);
    }
  };

  return (
    <ConnectorCard
      name={GMAIL_NAME}
      icon={Mail}
      tint={TINT}
      connected={connected}
      description={t('gmail.card.description')}
      account={connected ? { title: (typeof email === 'string' && email) || t('gmail.card.account') } : undefined}
    >
      {connected ? (
        <ConnectedActions
          openLabel={t('gmail.card.open')}
          openIcon={MailOpen}
          onOpen={() => router.push('/gmail')}
          onDisconnect={disconnect.confirm}
          disconnecting={disconnect.isPending}
        />
      ) : (
        <PrimaryButton size="md" label={t('gmail.card.connect')} onPress={() => void connect()} loading={busy} />
      )}
    </ConnectorCard>
  );
}
