import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity } from 'react-native';

import { relativeTime } from '@/lib/format';
import { CARD_SURFACE, LABEL_TEXT, TERTIARY_LABEL_TEXT, useCardShadow } from '@/lib/screen';

import type { AIConversation } from '../../chat.api';

/** Row height and the gap between rows (rooler business `ChatListScreen`). */
export const CHAT_ROW_HEIGHT = 52;
export const CHAT_ROW_GAP = 6;

/**
 * One conversation: a 52px card with the title on the left and a muted relative
 * timestamp on the right. Tap opens the chat; long press opens the actions sheet.
 *
 * `TouchableOpacity`, not `Pressable`: the card glow is a `style`, and NativeWind's
 * `Pressable` wrapper can drop it (see CLAUDE.md).
 */
export function ChatListRow({
  conversation,
  onOpen,
  onLongPress,
}: {
  conversation: AIConversation;
  onOpen: (conversation: AIConversation) => void;
  onLongPress: (conversation: AIConversation) => void;
}) {
  const { t } = useTranslation();
  const cardShadow = useCardShadow();
  const title = conversation.title?.trim() || t('chats.untitled');
  const time = relativeTime(
    conversation.last_message_at ?? conversation.updated_at ?? conversation.created_at,
  );

  return (
    <TouchableOpacity
      onPress={() => onOpen(conversation)}
      onLongPress={() => onLongPress(conversation)}
      delayLongPress={300}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={t('chats.rowHint')}
      className={`${CARD_SURFACE} flex-row items-center gap-3 px-3`}
      style={[cardShadow, { height: CHAT_ROW_HEIGHT }]}
    >
      <Text className={`flex-1 text-[16px] leading-6 ${LABEL_TEXT}`} numberOfLines={1}>
        {title}
      </Text>
      {time ? (
        <Text className={`text-[14px] leading-[22px] ${TERTIARY_LABEL_TEXT}`}>{time}</Text>
      ) : null}
    </TouchableOpacity>
  );
}
