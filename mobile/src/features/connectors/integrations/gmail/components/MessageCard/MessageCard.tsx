import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { displayFrom, fullDate } from '@/lib/format';
import { CARD_SURFACE, LABEL_TEXT, TERTIARY_LABEL_TEXT } from '@/lib/screen';

import type { GmailMessage } from '../../gmail.api';

/** One email of a thread: sender, recipients, date and the plain-text body. */
export function MessageCard({ message }: { message: GmailMessage }) {
  const { t } = useTranslation();
  const from = displayFrom(message.from);
  const body = typeof message.body_text === 'string' && message.body_text ? message.body_text : message.snippet;

  return (
    <View className={`${CARD_SURFACE} p-4`}>
      <View className="mb-3 flex-row items-center">
        <Avatar name={from} seed={message.from} size={36} />
        <View className="ml-2.5 flex-1">
          <Text className={`text-[15px] font-semibold ${LABEL_TEXT}`} numberOfLines={1}>
            {from}
          </Text>
          <Text className={`text-xs ${TERTIARY_LABEL_TEXT}`} numberOfLines={1}>
            {t('gmail.to', { to: message.to ?? '' })}
            {message.cc ? t('gmail.cc', { cc: message.cc }) : ''}
          </Text>
        </View>
        <Text className={`text-xs ${TERTIARY_LABEL_TEXT}`}>{fullDate(message.date)}</Text>
      </View>
      <Text className={`text-[15px] leading-[21px] ${LABEL_TEXT}`} selectable>
        {typeof body === 'string' ? body.trim() : ''}
      </Text>
    </View>
  );
}
