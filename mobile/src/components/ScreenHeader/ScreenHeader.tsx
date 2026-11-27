import React from 'react';
import { Text, View } from 'react-native';

import { LABEL_TEXT, SCREEN_PADDING_X } from '@/lib/screen';

export interface ScreenHeaderProps {
  title: string;
  /** Right-hand action tiles — build them from {@link HeaderIconButton}. */
  actions?: React.ReactNode;
  /** For E2E flows that find the screen by its title. */
  titleTestID?: string;
}

/**
 * The title row a **tab root** opens with: a 28px title on the left and up to a
 * couple of 44px action tiles on the right (Figma nodes 2455:46232, 2544:48584).
 *
 * The other half of the pair is {@link PageHeader}, which is what every pushed
 * page uses. The split is what the screen *is*, not how it looks: a tab root has
 * nowhere to go back to, so it carries no chevron and can afford the bigger
 * title; anything you navigate into gets `PageHeader`.
 *
 * Unlike `PageHeader` this does **not** add the safe-area inset — a tab root
 * already sits inside its own `SafeAreaView edges={['top', …]}`. The 20px above
 * it (`pt-5`) is the caller's, because it is usually shared with the blocks below.
 *
 * The row is always 44px — the height of a tile — whether or not it has any, so
 * a tab with no actions (or one whose only action is hidden, like the company
 * switch with a single company) lines its title up with every other tab.
 */
export const ScreenHeader = ({ title, actions, titleTestID }: ScreenHeaderProps) => (
  <View
    className="h-11 flex-row items-center justify-between"
    style={{ paddingHorizontal: SCREEN_PADDING_X }}
  >
    <Text testID={titleTestID} className={`text-[28px] font-semibold leading-9 ${LABEL_TEXT}`}>
      {title}
    </Text>
    {actions ? <View className="flex-row items-center gap-2">{actions}</View> : null}
  </View>
);
