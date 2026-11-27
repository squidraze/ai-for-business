import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { fullDate } from '@/lib/format';
import { CARD_SURFACE, LABEL_TEXT, TERTIARY_LABEL_TEXT } from '@/lib/screen';

import type { BitrixComment } from '../../bitrix24.api';

/** A timeline comment on a deal or lead. */
export function CommentCard({ comment }: { comment: BitrixComment }) {
  const { t } = useTranslation();
  const author = comment.author_name || t('bitrix.unknownUser');
  return (
    <View className={`${CARD_SURFACE} p-3`}>
      <View className="mb-2 flex-row items-center">
        <Avatar name={author} size={28} />
        <Text className={`mx-2 flex-1 text-sm font-semibold ${LABEL_TEXT}`} numberOfLines={1}>
          {author}
        </Text>
        <Text className={`text-xs ${TERTIARY_LABEL_TEXT}`}>{fullDate(comment.created)}</Text>
      </View>
      <Text className={`text-[15px] leading-[21px] ${LABEL_TEXT}`} selectable>
        {typeof comment.text === 'string' ? comment.text.trim() : ''}
      </Text>
    </View>
  );
}
