import type { ConnectorDefinition } from '../../types';
import { BITRIX24_NAME, Bitrix24ConnectorCard } from './components/Bitrix24ConnectorCard';

export { BitrixCrmPage } from './CrmPage';
export { BitrixRecordPage } from './RecordPage';
export type { BitrixDeal, BitrixEntity, BitrixLead } from './bitrix24.api';

/** Bitrix24's entry in the connectors registry. */
export const bitrix24Connector: ConnectorDefinition = {
  id: 'bitrix24',
  name: BITRIX24_NAME,
  Card: Bitrix24ConnectorCard,
};
