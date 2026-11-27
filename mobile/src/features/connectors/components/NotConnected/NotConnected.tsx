import { Link } from 'lucide-react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '@/components/PrimaryButton';
import { EmptyView } from '@/components/StateView';

/**
 * In place of a list when the integration isn't connected (409 /
 * `*_not_connected`): says so and leads to the Connectors tab instead of Retry.
 */
export function NotConnected({ name, message }: { name: string; message?: string | null }) {
  const { t } = useTranslation();
  return (
    <EmptyView
      icon={Link}
      title={t('connectors.notConnectedTitle', { name })}
      description={message || t('connectors.notConnectedText')}
    >
      <PrimaryButton
        size="md"
        label={t('connectors.openConnectors')}
        onPress={() => router.navigate('/connectors')}
        className="mt-4 min-w-[180px] px-5"
      />
    </EmptyView>
  );
}
