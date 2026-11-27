import { useLocalSearchParams } from 'expo-router';
import { Reply, Send } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTextInput } from '@/components/AppTextInput';
import { AsyncState } from '@/components/AsyncState';
import { FeatureBoundary } from '@/components/FeatureBoundary';
import { PageHeader } from '@/components/PageHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Skeleton } from '@/components/Skeleton';
import { errorMessage } from '@/lib/api';
import { CARD_SURFACE } from '@/lib/screen';
import { useColors } from '@/lib/theme';

import { NotConnected } from '../../components';
import { isNotConnectedError } from '../../errors';
import { GMAIL_NAME } from './components/GmailConnectorCard';
import { MessageCard } from './components/MessageCard';
import { useGmailReply, useGmailThread } from './gmail.hooks';

/** One email thread with a reply box. */
export function GmailThreadPage() {
  const c = useColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ threadId: string; subject?: string }>();
  const threadId = params.threadId ?? '';
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const query = useGmailThread(threadId);
  const sendReply = useGmailReply(threadId);
  const messages = query.data?.messages ?? [];
  const title = query.data?.subject || params.subject || t('gmail.noSubject');

  const send = async () => {
    const body = reply.trim();
    if (!body || sendReply.isPending) return;
    try {
      await sendReply.mutateAsync(body);
      setReply('');
      setReplying(false);
    } catch (e) {
      Alert.alert(t('gmail.replyNotSent'), errorMessage(e));
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const neutral = {
    colorClassName: 'bg-zinc-200 dark:bg-zinc-800',
    textClassName: 'text-zinc-800 dark:text-zinc-50',
    iconColor: c.text,
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeader title={title} />
      <FeatureBoundary name="gmail/thread" onReset={() => void query.refetch()} resetKey={threadId} fullScreen>
        <AsyncState
          query={query}
          skeleton={<ThreadSkeleton />}
          error={(error) =>
            isNotConnectedError(error) ? <NotConnected name={GMAIL_NAME} message={errorMessage(error)} /> : null
          }
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
        >
          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 12 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void onRefresh()}
                tintColor={c.primary}
                colors={[c.primary]}
              />
            }
          >
            {messages.map((message) => (
              <MessageCard key={message.id} message={message} />
            ))}
          </ScrollView>
        </AsyncState>
      </FeatureBoundary>

      {query.data ? (
        <View
          className="border-t border-zinc-200 bg-white px-3 pt-2.5 dark:border-zinc-800 dark:bg-zinc-900"
          style={{ paddingBottom: Math.max(insets.bottom, 10) }}
        >
          {replying ? (
            <>
              <AppTextInput
                value={reply}
                onChangeText={setReply}
                placeholder={t('gmail.replyPlaceholder')}
                multiline
                autoFocus
              />
              <View className="mt-2.5 flex-row gap-2.5">
                <PrimaryButton
                  size="md"
                  label={t('common.cancel')}
                  onPress={() => setReplying(false)}
                  className="flex-1"
                  {...neutral}
                />
                <PrimaryButton
                  size="md"
                  label={t('gmail.send')}
                  icon={Send}
                  onPress={() => void send()}
                  disabled={!reply.trim()}
                  loading={sendReply.isPending}
                  className="flex-1"
                />
              </View>
            </>
          ) : (
            <PrimaryButton size="md" label={t('gmail.reply')} icon={Reply} onPress={() => setReplying(true)} {...neutral} />
          )}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function ThreadSkeleton() {
  return (
    <View className="gap-3 p-4" accessibilityRole="progressbar" accessibilityState={{ busy: true }}>
      {Array.from({ length: 2 }).map((_, index) => (
        <View key={index} className={`${CARD_SURFACE} p-4`}>
          <View className="mb-4 flex-row items-center">
            <Skeleton width={36} height={36} radius={18} />
            <View className="ml-2.5 flex-1">
              <Skeleton width="50%" />
              <Skeleton width="70%" height={10} style={{ marginTop: 6 }} />
            </View>
          </View>
          <Skeleton width="95%" />
          <Skeleton width="90%" style={{ marginTop: 8 }} />
          <Skeleton width="60%" style={{ marginTop: 8 }} />
        </View>
      ))}
    </View>
  );
}
