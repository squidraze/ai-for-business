import { bitrix24Connector } from './integrations/bitrix24';
import { gmailConnector } from './integrations/gmail';
import { telegramConnector } from './integrations/telegram';
import type { ConnectorDefinition } from './types';

/**
 * Every integration on the Connectors tab, in display order. Adding an
 * integration = a folder in `integrations/` and one line here.
 */
export const CONNECTORS: ConnectorDefinition[] = [telegramConnector, gmailConnector, bitrix24Connector];
