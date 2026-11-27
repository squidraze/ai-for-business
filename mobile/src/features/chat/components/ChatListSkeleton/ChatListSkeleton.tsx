import { View } from 'react-native';

import { Skeleton } from '@/components/Skeleton';
import { CARD_SURFACE, SCREEN_PADDING_X, useCardShadow } from '@/lib/screen';

import { CHAT_ROW_GAP, CHAT_ROW_HEIGHT } from '../ChatListRow';

/** Varied bar widths so the placeholder reads like a ragged list of titles. */
const WIDTHS = ['72%', '54%', '81%', '46%', '67%', '60%', '76%'] as const;

/**
 * Loading placeholder that mirrors {@link ChatListRow} exactly — same 52px card,
 * gutter and gap — so nothing shifts when the data arrives.
 */
export function ChatListSkeleton({ topGap = 12 }: { topGap?: number }) {
  const cardShadow = useCardShadow();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      style={{ paddingHorizontal: SCREEN_PADDING_X, paddingTop: topGap, gap: CHAT_ROW_GAP }}
    >
      {WIDTHS.map((width, i) => (
        <View
          key={i}
          className={`${CARD_SURFACE} flex-row items-center gap-3 px-3`}
          style={[cardShadow, { height: CHAT_ROW_HEIGHT }]}
        >
          <View style={{ flex: 1 }}>
            <Skeleton width={width} height={16} radius={6} />
          </View>
          <Skeleton width={40} height={12} radius={6} />
        </View>
      ))}
    </View>
  );
}
