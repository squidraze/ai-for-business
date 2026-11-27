import type { ConnectorDefinition } from '../../types';
import { TELEGRAM_NAME, TelegramConnectorCard } from './components/TelegramConnectorCard';

export { TelegramChatPage } from './ChatPage';
export { TelegramChatsPage } from './ChatsPage';
export { TelegramConnectPage } from './ConnectPage';
export type { TelegramAccount, TelegramDialog, TelegramMessage } from './telegram.api';

/** Telegram's entry in the connectors registry. */
export const telegramConnector: ConnectorDefinition = {
  id: 'telegram',
  name: TELEGRAM_NAME,
  Card: TelegramConnectorCard,
};
