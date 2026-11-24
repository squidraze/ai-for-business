import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import { EmptyView } from '@/components/StateView';

/** The task was deleted (404 schedule_not_found). */
export function ScheduleNotFound() {
  const { t } = useTranslation();
  return (
    <EmptyView icon="alert-circle-outline" title={t('schedules.notFoundTitle')} description={t('errors.schedule_not_found')}>
      <Button
        title={t('schedules.backToList')}
        variant="secondary"
        onPress={() => {
          if (router.canDismiss()) router.dismissAll();
          router.navigate('/schedules');
        }}
        style={{ marginTop: 16, minWidth: 180 }}
      />
    </EmptyView>
  );
}
