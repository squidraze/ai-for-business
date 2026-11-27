import { CircleAlert } from 'lucide-react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '@/components/PrimaryButton';
import { EmptyView } from '@/components/StateView';
import { useLabelColors } from '@/lib/screen';

/** The task was deleted (404 schedule_not_found). */
export function ScheduleNotFound() {
  const { t } = useTranslation();
  const labels = useLabelColors();
  return (
    <EmptyView icon={CircleAlert} title={t('schedules.notFoundTitle')} description={t('errors.schedule_not_found')}>
      <PrimaryButton
        label={t('schedules.backToList')}
        size="md"
        colorClassName="bg-gray-100 dark:bg-zinc-800"
        textClassName="text-black dark:text-white"
        iconColor={labels.label}
        onPress={() => {
          if (router.canDismiss()) router.dismissAll();
          router.navigate('/schedules');
        }}
        className="mt-4 min-w-[180px] px-5"
      />
    </EmptyView>
  );
}
