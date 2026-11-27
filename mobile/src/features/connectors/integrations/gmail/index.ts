import type { ConnectorDefinition } from '../../types';
import { GMAIL_NAME, GmailConnectorCard } from './components/GmailConnectorCard';

export { GmailComposePage } from './ComposePage';
export { GmailInboxPage } from './InboxPage';
export { GmailThreadPage } from './ThreadPage';
export type { GmailMessage, GmailThread, GmailThreadSummary } from './gmail.api';

/** Gmail's entry in the connectors registry. */
export const gmailConnector: ConnectorDefinition = {
  id: 'gmail',
  name: GMAIL_NAME,
  Card: GmailConnectorCard,
};
