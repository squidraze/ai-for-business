import type { ComponentType } from 'react';

import type { ConnectorStatus } from './connectors.api';

export type ConnectorCardProps = {
  /** This integration's row from `GET /connectors`; undefined if the backend didn't list it. */
  status: ConnectorStatus | undefined;
};

/**
 * What an integration gives the Connectors tab. Each integration exports one from
 * its `index.ts`; `registry.ts` lists them.
 */
export type ConnectorDefinition = {
  /** Backend connector id (`telegram`, `gmail`, `bitrix24`…). */
  id: string;
  /** Brand name, not translated. */
  name: string;
  /** The card on the Connectors tab: status, account, connect/open/disconnect. */
  Card: ComponentType<ConnectorCardProps>;
};
