import { router, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { WebChatScreen } from './components/WebChatScreen';

/** One conversation (or `new`): the WebView chat hosted natively. */
export function ChatPage() {
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
