import { MessageCircle } from 'lucide-react-native';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform } from 'react-native';

import { AsyncState } from '@/components/AsyncState';
import { FeatureBoundary } from '@/components/FeatureBoundary';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonList } from '@/components/Skeleton';
import { EmptyView } from '@/components/StateView';
import { errorMessage } from '@/lib/api';
import { useColors } from '@/lib/theme';

import { ComposerBar, NotConnected } from '../../components';
import { isNotConnectedError } from '../../errors';
import { MessageBubble } from './components/MessageBubble';
import { TELEGRAM_NAME } from './components/TelegramConnectorCard';
import { useTelegramChat } from './telegram.hooks';

/** One Telegram chat: messages (newest at the bottom, older on scroll) and a composer. */
export function TelegramChatPage() {
  const c = useColors();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ chatId: string; title?: string; type?: string }>();
  const chatId = params.chatId ?? '';
  const isGroup = params.type === 'group' || params.type === 'channel';
  const [draft, setDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { latest, messages, loadOlder, loadingOlder, send, sending } = useTelegramChat(chatId);

  const onSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    try {
      await send(text);
      setDraft('');
    } catch (e) {
      Alert.alert(t('telegram.notSent'), errorMessage(e));
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await latest.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeader title={params.title || t('telegram.chatFallback')} inlineTitle />
      <FeatureBoundary name="telegram/messages" onReset={() => void latest.refetch()} resetKey={chatId} fullScreen>
        {/* An inverted list flips its ListEmptyComponent, so the empty state stays
            in AsyncState (with its own pull-to-refresh). */}
        <AsyncState
          query={latest}
          isEmpty={messages.length === 0}
          skeleton={<SkeletonList avatar={false} />}
          empty={<EmptyView icon={MessageCircle} title={t('telegram.noMessages')} />}
          error={(error) =>
            isNotConnectedError(error) ? <NotConnected name={TELEGRAM_NAME} message={errorMessage(error)} /> : null
          }
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
        >
          <FlatList
            inverted
            data={messages}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8, flexGrow: 1 }}
            onEndReached={() => void loadOlder()}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              loadingOlder ? <ActivityIndicator style={{ margin: 12 }} color={c.primary} /> : undefined
            }
            renderItem={({ item, index }) => {
              const above = messages[index + 1];
              const showSender =
                isGroup && !item.out && !!item.sender_name && above?.sender_id !== item.sender_id;
              return <MessageBubble message={item} showSender={showSender} />;
            }}
          />
        </AsyncState>
      </FeatureBoundary>
      <ComposerBar
        value={draft}
        onChangeText={setDraft}
        onSend={() => void onSend()}
        sending={sending}
        placeholder={t('telegram.messagePlaceholder')}
      />
    </KeyboardAvoidingView>
  );
}
