import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { displayFrom, relativeTime } from '@/lib/format';
import { LABEL_TEXT, TERTIARY_LABEL_TEXT } from '@/lib/screen';

import type { GmailThreadSummary } from '../../gmail.api';

/** One inbox thread: sender, count, date, subject, snippet; bold while unread. */
export function ThreadRow({ thread, onPress }: { thread: GmailThreadSummary; onPress: () => void }) {
  const { t } = useTranslation();
  const from = displayFrom(thread.from);
  const unread = !!thread.unread;
  const count = typeof thread.message_count === 'number' ? thread.message_count : 0;

  return (
    <TouchableOpacity activeOpacity={0.6} className="flex-row px-3.5 py-3" onPress={onPress}>
      <Avatar name={from} seed={thread.from} size={44} />
      <View className="ml-3 flex-1">
        <View className="flex-row items-center justify-between">
          <Text
            className={`mr-2 flex-1 text-[15px] ${LABEL_TEXT} ${unread ? 'font-bold' : 'font-normal'}`}
            numberOfLines={1}
          >
            {from || t('gmail.unknownSender')}
            {count > 1 ? <Text className={`font-normal ${TERTIARY_LABEL_TEXT}`}>{`  ${count}`}</Text> : null}
          </Text>
          <Text className={`text-xs ${unread ? 'font-bold text-primary' : `font-normal ${TERTIARY_LABEL_TEXT}`}`}>
            {relativeTime(thread.date)}
          </Text>
        </View>
        <Text
          className={`mt-0.5 text-sm ${LABEL_TEXT} ${unread ? 'font-bold' : 'font-medium'}`}
          numberOfLines={1}
        >
          {thread.subject || t('gmail.noSubject')}
        </Text>
        <Text className={`mt-0.5 text-[13px] ${TERTIARY_LABEL_TEXT}`} numberOfLines={2}>
          {thread.snippet ?? ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
