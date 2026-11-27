import { router } from 'expo-router';
import { Check, Globe, Play, Plus, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedSwitch } from '@/components/AnimatedSwitch';
import { FormError } from '@/components/FormError';
import { KeyboardAwareForm, KeyboardTarget } from '@/components/KeyboardAwareForm';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Skeleton } from '@/components/Skeleton';
import { TextField } from '@/components/TextField';
import { errorMessage } from '@/lib/api';
import { useLabelColors } from '@/lib/screen';
import { useColors } from '@/lib/theme';

import { deviceTimeZone } from '../../recurrence';
import type { Schedule } from '../../schedules.api';
import {
  useCreateSchedule,
  useDeleteSchedule,
  useRunSchedule,
  useUpdateSchedule,
} from '../../schedules.hooks';
import {
  DEFAULT_VALUES,
  toScheduleInput,
  useScheduleForm,
  valuesFromSchedule,
} from '../../useScheduleForm';
import { PROMPT_MAX } from '../../validation';
import { ExamplePrompts } from '../ExamplePrompts';
import { FieldGroup } from '../FieldGroup';
import { FrequencyPicker } from '../FrequencyPicker';
import { IntervalPicker } from '../IntervalPicker';
import { NotifyPicker } from '../NotifyPicker';
import { TimeField } from '../TimeField';
import { WeekdayPicker } from '../WeekdayPicker';

/** iOS navigation bar height under the status bar (for the keyboard offset). */
const IOS_HEADER_HEIGHT = 44;

/** Create (no `schedule`) or edit a task. */
export function ScheduleForm({ schedule }: { schedule?: Schedule }) {
  const c = useColors();
  const labelColors = useLabelColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const initial = useMemo(() => (schedule ? valuesFromSchedule(schedule) : DEFAULT_VALUES), [schedule]);
  const form = useScheduleForm(initial);
  const { values, setValue } = form;
  const timezone = useMemo(() => deviceTimeZone(), []);
  const uuid = schedule?.uuid ?? '';

  const create = useCreateSchedule();
  const update = useUpdateSchedule(uuid);
  const remove = useDeleteSchedule();
  const run = useRunSchedule(uuid);
  const [runMessage, setRunMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const saving = create.isPending || update.isPending;
  const busy = saving || remove.isPending;

  const submit = () => {
    if (busy || !form.validate()) return;
    const body = toScheduleInput(values, timezone);
    if (schedule) {
      update.mutate(body, {
        onSuccess: () => router.back(),
        onError: (error) => form.applyServerError(error),
      });
    } else {
      create.mutate(body, {
        onSuccess: (created) => router.replace({ pathname: '/schedules/[id]', params: { id: created.uuid } }),
        onError: (error) => form.applyServerError(error),
      });
    }
  };

  const confirmDelete = () => {
    if (!schedule) return;
    Alert.alert(t('schedules.deleteConfirmTitle'), t('schedules.deleteConfirmText', { title: schedule.title }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          remove.mutate(schedule.uuid, {
            onSuccess: () => {
              if (router.canDismiss()) router.dismissAll();
              router.navigate('/schedules');
            },
            onError: (error) => Alert.alert(t('schedules.deleteFailed'), errorMessage(error)),
          }),
      },
    ]);
  };

  const runNow = () => {
    setRunMessage(null);
    run.mutate(undefined, {
      onSuccess: () => setRunMessage({ ok: true, text: t('schedules.runStarted') }),
      onError: (error) => setRunMessage({ ok: false, text: errorMessage(error) }),
    });
  };

  const promptLength = values.prompt.trim().length;

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAwareForm
        contentContainerStyle={styles.container}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + IOS_HEADER_HEIGHT : 0}
      >
        <FormError message={form.formError} />

        {!schedule ? (
          <FieldGroup label={t('schedules.examplesLabel')}>
            <ExamplePrompts
              disabled={busy}
              onPick={(example) => {
                setValue('prompt', example.prompt, { touch: true });
                if (!values.title.trim()) setValue('title', example.title, { touch: true });
              }}
            />
          </FieldGroup>
        ) : null}

        <TextField
          ref={form.textRef('title')}
          label={t('schedules.fields.title')}
          placeholder={t('schedules.fields.titlePlaceholder')}
          value={values.title}
          onChangeText={(text) => setValue('title', text)}
          onBlur={() => form.blur('title')}
          error={form.error('title')}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => form.focus('prompt')}
          editable={!busy}
        />
        <TextField
          ref={form.textRef('prompt')}
          label={t('schedules.fields.prompt')}
          placeholder={t('schedules.fields.promptPlaceholder')}
          value={values.prompt}
          onChangeText={(text) => setValue('prompt', text)}
          onBlur={() => form.blur('prompt')}
          error={form.error('prompt')}
          multiline
          counter={t('schedules.charCount', { n: promptLength, max: PROMPT_MAX })}
          counterError={promptLength > PROMPT_MAX}
          editable={!busy}
        />

        <FieldGroup label={t('schedules.fields.frequency')} error={form.error('kind')}>
          <FrequencyPicker
            value={values.kind}
            onChange={(kind) => setValue('kind', kind, { touch: true })}
            disabled={busy}
          />
        </FieldGroup>

        {values.kind === 'weekly' ? (
          <FieldGroup label={t('schedules.fields.weekdays')} error={form.error('weekdays')}>
            <WeekdayPicker
              value={values.weekdays}
              onChange={(days) => setValue('weekdays', days, { touch: true })}
              invalid={!!form.error('weekdays')}
              disabled={busy}
            />
          </FieldGroup>
        ) : null}

        {values.kind !== 'interval' ? (
          <FieldGroup label={t('schedules.fields.time')} error={form.error('time_of_day')}>
            <TimeField
              value={values.time_of_day}
              onChange={(time) => setValue('time_of_day', time, { touch: true })}
              invalid={!!form.error('time_of_day')}
              disabled={busy}
            />
          </FieldGroup>
        ) : (
          <FieldGroup label={t('schedules.fields.interval')} error={form.error('interval_minutes')}>
            <IntervalPicker
              value={values.interval_minutes}
              onChange={(minutes) => setValue('interval_minutes', minutes, { touch: true })}
              invalid={!!form.error('interval_minutes')}
              disabled={busy}
            />
          </FieldGroup>
        )}

        <FieldGroup label={t('schedules.fields.timezone')} error={form.error('timezone')}>
          <View style={[styles.readOnly, { backgroundColor: c.inputBg, borderColor: c.border }]}>
            <Globe size={18} color={c.muted} />
            <Text style={[styles.readOnlyText, { color: c.text }]} numberOfLines={1}>
              {timezone}
            </Text>
            <Text style={{ color: c.muted, fontSize: 13 }}>{t('schedules.deviceTimezone')}</Text>
          </View>
        </FieldGroup>

        <FieldGroup label={t('schedules.fields.notify')} error={form.error('notify')}>
          <NotifyPicker
            value={values.notify}
            onChange={(notify) => setValue('notify', notify, { touch: true })}
            disabled={busy}
          />
        </FieldGroup>

        <View style={[styles.switchRow, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '500' }}>{t('schedules.fields.enabled')}</Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>{t('schedules.fields.enabledHint')}</Text>
          </View>
          <AnimatedSwitch
            value={values.enabled}
            onValueChange={(enabled) => setValue('enabled', enabled)}
            disabled={busy}
            accessibilityLabel={t('schedules.fields.enabled')}
          />
        </View>

        <KeyboardTarget>
          <PrimaryButton
            label={schedule ? t('schedules.save') : t('schedules.create')}
            icon={schedule ? Check : Plus}
            size="base"
            className="mt-5"
            onPress={submit}
            loading={saving}
            disabled={remove.isPending}
          />
        </KeyboardTarget>

        <Text style={[styles.explain, { color: c.muted }]}>{t('schedules.explain')}</Text>

        {schedule ? (
          <View style={styles.extra}>
            <PrimaryButton
              label={t('schedules.runNow')}
              icon={Play}
              size="base"
              colorClassName="bg-gray-100 dark:bg-zinc-800"
              textClassName="text-black dark:text-white"
              iconColor={labelColors.label}
              onPress={runNow}
              loading={run.isPending}
              disabled={busy}
            />
            {runMessage ? (
              <Text
                style={[styles.runMessage, { color: runMessage.ok ? c.success : c.danger }]}
                accessibilityLiveRegion="polite"
              >
                {runMessage.text}
              </Text>
            ) : null}
            <PrimaryButton
              label={t('schedules.delete')}
              icon={Trash2}
              size="base"
              colorClassName="bg-red-50 dark:bg-red-500/15"
              textClassName="text-red-600 dark:text-red-400"
              iconColor={c.danger}
              onPress={confirmDelete}
              loading={remove.isPending}
              disabled={saving}
            />
          </View>
        ) : null}
      </KeyboardAwareForm>
    </SafeAreaView>
  );
}

/** Placeholder shaped like the form while an existing task loads. */
export function ScheduleFormSkeleton() {
  const block = (labelWidth: number, height: number) => (
    <View style={{ marginBottom: 18 }}>
      <Skeleton width={labelWidth} height={12} style={{ marginBottom: 8 }} />
      <Skeleton height={height} radius={12} />
    </View>
  );
  return (
    <View style={styles.container} accessibilityRole="progressbar" accessibilityState={{ busy: true }}>
      {block(60, 50)}
      {block(90, 120)}
      {block(80, 44)}
      {block(50, 50)}
      {block(110, 150)}
      <Skeleton height={48} radius={12} style={{ marginTop: 12 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 32 },
  readOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    gap: 10,
  },
  readOnlyText: { flex: 1, fontSize: 16 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 12,
  },
  explain: { fontSize: 13, lineHeight: 18, marginTop: 12, textAlign: 'center' },
  extra: { marginTop: 24, gap: 12 },
  runMessage: { fontSize: 14, textAlign: 'center' },
});
