import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { Plug, Plus, SquarePen, MessagesSquare } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AsyncState } from '@/components/AsyncState';
import { FeatureBoundary } from '@/components/FeatureBoundary';
import { HeaderIconButton } from '@/components/HeaderIconButton';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyView } from '@/components/StateView';
import { SCREEN_PADDING_X, useLabelColors } from '@/lib/screen';
import { useColors } from '@/lib/theme';

import type { AIConversation } from './chat.api';
import { invalidateConversations, useConversations } from './chat.hooks';
import { ChatActionsSheet } from './components/ChatActionsSheet';
import { CHAT_ROW_GAP, ChatListRow } from './components/ChatListRow';
import { ChatListSkeleton } from './components/ChatListSkeleton';

/** Breathing room between the header and the first row. */
const LIST_TOP_GAP = 12;

const openChat = (conversation: AIConversation) =>
  router.push({
    pathname: '/chat/[id]',
    params: { id: conversation.uuid, title: conversation.title ?? '' },
  });
const newChat = () => router.push('/chat/new');
const openIntegrations = () => router.navigate('/connectors');

/**
 * The "Chats" tab (design: rooler business `ChatListScreen`): a 28px title with
 * Integrations and New chat tiles, then a stack of 52px conversation cards.
 * Tap opens a chat, long press opens rename / delete. Loading → error → empty →
 * content, with native pull-to-refresh throughout.
 */
export function ChatsPage() {
  const { t } = useTranslation();
  const c = useColors();
  const labelColors = useLabelColors();
  const queryClient = useQueryClient();
  const query = useConversations();
  const items = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];

  // The WebView creates and titles conversations: refresh whenever we come back.
  useFocusEffect(
    useCallback(() => {
      void invalidateConversations(queryClient);
    }, [queryClient]),
  );

  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [query]);

  const [selected, setSelected] = useState<AIConversation | null>(null);

  const empty = (
    <EmptyView icon={MessagesSquare} title={t('chats.emptyTitle')} description={t('chats.emptyText')}>
      <PrimaryButton
        label={t('chats.start')}
        icon={Plus}
        size="md"
        className="mt-4 px-6"
        onPress={newChat}
      />
    </EmptyView>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: c.bg }}>
      <View className="pt-5">
        <ScreenHeader
          title={t('chats.title')}
          actions={
            <>
              <HeaderIconButton onPress={openIntegrations} accessibilityLabel={t('chats.integrations')}>
                <Plug size={20} color={labelColors.label} />
              </HeaderIconButton>
              <HeaderIconButton onPress={newChat} accessibilityLabel={t('chats.newChat')}>
                <SquarePen size={20} color={labelColors.label} />
              </HeaderIconButton>
            </>
          }
        />
      </View>

      {/* Only the list renders backend rows: if one cannot draw, the header with
          "New chat" keeps working. */}
      <FeatureBoundary name="chat/list" fullScreen onReset={() => void query.refetch()}>
        <AsyncState
          query={query}
          skeleton={<ChatListSkeleton topGap={LIST_TOP_GAP} />}
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
        >
          <FlatList
            data={items}
            keyExtractor={(item) => item.uuid}
            renderItem={({ item }) => (
              <ChatListRow conversation={item} onOpen={openChat} onLongPress={setSelected} />
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: SCREEN_PADDING_X,
              paddingTop: LIST_TOP_GAP,
              paddingBottom: 24,
              gap: CHAT_ROW_GAP,
              flexGrow: 1,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void onRefresh()}
                tintColor={c.primary}
                colors={[c.primary]}
              />
            }
            ListEmptyComponent={empty}
            onEndReached={() => {
              if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
            }}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              query.isFetchingNextPage ? (
                <ActivityIndicator style={{ margin: 16 }} color={c.primary} />
              ) : undefined
            }
          />
        </AsyncState>
      </FeatureBoundary>

      {selected ? <ChatActionsSheet conversation={selected} onClose={() => setSelected(null)} /> : null}
    </SafeAreaView>
  );
}
