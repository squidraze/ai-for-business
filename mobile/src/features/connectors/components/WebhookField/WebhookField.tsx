import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { AppTextInput } from '@/components/AppTextInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { INSET_SURFACE, LABEL_TEXT, TERTIARY_LABEL_TEXT } from '@/lib/screen';

import { useConnectorsScroll } from '../../scrollContext';

export interface WebhookFieldProps {
  /** Numbered "how to get the URL" steps above the field. */
  steps: string[];
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  loading?: boolean;
  placeholder?: string;
}

/** Connect an integration by pasting a webhook / API URL. */
export function WebhookField({ steps, value, onChangeText, onSubmit, loading, placeholder }: WebhookFieldProps) {
  const { t } = useTranslation();
  const { revealEnd } = useConnectorsScroll();
  return (
    <View>
      {steps.length > 0 ? (
        <View className={`mb-3.5 rounded-xl p-3 ${INSET_SURFACE}`}>
          <Text className={`mb-1 text-sm font-semibold ${LABEL_TEXT}`}>{t('connectors.howToConnect')}</Text>
          {steps.map((step, index) => (
            <View key={step} className="mt-1 flex-row">
              <Text className={`w-5 text-sm leading-5 ${TERTIARY_LABEL_TEXT}`}>{index + 1}.</Text>
              <Text className={`flex-1 text-sm leading-5 ${LABEL_TEXT}`}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <AppTextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        textContentType="URL"
        returnKeyType="done"
        editable={!loading}
        onSubmitEditing={onSubmit}
        onFocus={revealEnd}
        containerClassName="mb-3"
      />
      <PrimaryButton
        size="md"
        label={t('connectors.connect')}
        onPress={onSubmit}
        disabled={!value.trim()}
        loading={loading}
      />
    </View>
  );
}
