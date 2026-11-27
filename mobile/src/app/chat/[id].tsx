import { router, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { WebChatScreen } from '@/webchat/WebChatScreen';

export { ErrorBoundary } from '@/components/ErrorBoundary';

export default function ChatScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();

  const openList = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  const newChat = useCallback(() => router.setParams({ id: 'new', title: '' }), []);

  const openIntegrations = useCallback(() => router.navigate('/connectors'), []);

  return (
    <WebChatScreen
      threadId={id}
      initialTitle={title}
      onOpenList={openList}
      onNewChat={newChat}
      onOpenIntegrations={openIntegrations}
    />
  );
}
