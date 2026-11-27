import { api } from '@/lib/api';

/** One row of `GET /api/v1/connectors`: is the integration connected, and as whom. */
export type ConnectorStatus = {
  /** Integration id, the same as `ConnectorDefinition.id` in the registry. */
  id: string;
  connected: boolean;
  account: Record<string, unknown> | null;
};

export const connectorsApi = {
  list: async (): Promise<ConnectorStatus[]> => {
    const { data } = await api.get<ConnectorStatus[]>('/api/v1/connectors');
    return Array.isArray(data) ? data : [];
  },
};
