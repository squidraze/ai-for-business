import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { relativeTime } from '@/lib/format';
import { LABEL_TEXT, TERTIARY_LABEL_TEXT } from '@/lib/screen';

import { dialogPhotoSource, type TelegramDialog } from '../../telegram.api';

/** One chat in the Telegram list: avatar, title, time, last message, unread badge. */
export function DialogRow({ dialog, onPress }: { dialog: TelegramDialog; onPress: () => void }) {
  const { t } = useTranslation();
  const last = dialog.last_message;
  const unread = typeof dialog.unread_count === 'number' ? dialog.unread_count : 0;
  const preview = last ? `${last.out ? t('telegram.you') : ''}${last.text || t('telegram.mediaPreview')}` : ' ';

  return (
    <TouchableOpacity activeOpacity={0.6} className="flex-row items-center px-3 py-2.5" onPress={onPress}>
      <Avatar name={dialog.title} seed={dialog.id} size={52} {...dialogPhotoSource(String(dialog.id ?? ''))} />
      <View className="ml-3 flex-1">
        <View className="flex-row items-center justify-between">
          <Text className={`mr-2 flex-1 text-base font-semibold ${LABEL_TEXT}`} numberOfLines={1}>
            {dialog.title || t('telegram.unnamed')}
          </Text>
          <Text className={`text-xs ${TERTIARY_LABEL_TEXT}`}>{relativeTime(last?.date)}</Text>
        </View>
        <View className="flex-row items-center justify-between">
          <Text className={`mr-2 mt-0.5 flex-1 text-sm ${TERTIARY_LABEL_TEXT}`} numberOfLines={1}>
            {preview}
          </Text>
          {unread > 0 ? (
            <View className="mt-0.5 h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary px-1.5">
              <Text className="text-xs font-bold text-white">{unread > 999 ? '999+' : unread}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}
