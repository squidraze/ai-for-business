import type { LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { useColors } from '@/lib/theme';

export interface ConnectedActionsProps {
  openLabel: string;
  openIcon?: LucideIcon;
  onOpen: () => void;
  onDisconnect: () => void;
  disconnecting?: boolean;
}

/** The two buttons of a connected integration: open its screens, disconnect. */
export function ConnectedActions({
  openLabel,
  openIcon,
  onOpen,
  onDisconnect,
  disconnecting,
}: ConnectedActionsProps) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View className="gap-2.5">
      <PrimaryButton size="md" label={openLabel} icon={openIcon} onPress={onOpen} />
      <PrimaryButton
        size="md"
        label={t('connectors.disconnect')}
        onPress={onDisconnect}
        loading={disconnecting}
        colorClassName="bg-red-50 dark:bg-red-500/15"
        textClassName="text-red-600 dark:text-red-400"
        iconColor={c.danger}
      />
    </View>
  );
}
