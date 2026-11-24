import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';

import { Chip } from '@/components/Chip';

const EXAMPLES = ['summary', 'followUp', 'deals'] as const;

/** Ready-made instructions; tapping one fills the form. */
export function ExamplePrompts({
  onPick,
  disabled,
}: {
  onPick: (example: { title: string; prompt: string }) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.row}
    >
      {EXAMPLES.map((key) => (
        <Chip
          key={key}
          icon="sparkles-outline"
          label={t(`schedules.examples.${key}.title`)}
          disabled={disabled}
          onPress={() =>
            onPick({
              title: t(`schedules.examples.${key}.title`),
              prompt: t(`schedules.examples.${key}.prompt`),
            })
          }
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingBottom: 2 },
});
