import { api } from '@/lib/api';

export type BitrixAccount = { portal: string; user_name: string; user_id: string };

export type BitrixEntity = 'deals' | 'leads';

export type BitrixDeal = {
  id: string;
  title: string;
  stage_id: string;
  stage_name: string;
  opportunity: number | null;
  currency: string | null;
  contact_name: string | null;
  company_title: string | null;
  assigned_name: string | null;
  date_create: string | null;
  date_modify: string | null;
  comments_text: string | null;
  url: string;
};

export type BitrixLead = {
  id: string;
  title: string;
  status_id: string;
  status_name: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  opportunity: number | null;
  currency: string | null;
  assigned_name: string | null;
  source: string | null;
  date_create: string | null;
  date_modify: string | null;
  comments_text: string | null;
  url: string;
};

export type BitrixRecord = BitrixDeal | BitrixLead;

export type BitrixComment = {
  id: string;
  text: string;
  author_name: string | null;
  created: string | null;
};

export type BitrixPage<T> = { items: T[]; next: number | null };

export type BitrixDealDetail = BitrixDeal & { comments: BitrixComment[] };
export type BitrixLeadDetail = BitrixLead & { comments: BitrixComment[] };
export type BitrixDetail = BitrixDealDetail | BitrixLeadDetail;

export function isBitrixEntity(value: unknown): value is BitrixEntity {
  return value === 'deals' || value === 'leads';
}

const BASE = '/api/v1/connectors/bitrix24';
const recordPath = (entity: BitrixEntity, id: string) => `${BASE}/${entity}/${encodeURIComponent(id)}`;

export const bitrixApi = {
  list: async (entity: BitrixEntity, params: { start: number; q?: string }): Promise<BitrixPage<BitrixRecord>> => {
    const { data } = await api.get<BitrixPage<BitrixRecord>>(`${BASE}/${entity}`, {
      params: { start: params.start, ...(params.q ? { q: params.q } : {}) },
    });
    return { items: Array.isArray(data?.items) ? data.items : [], next: data?.next ?? null };
  },
  detail: async (entity: BitrixEntity, id: string): Promise<BitrixDetail> =>
    (await api.get<BitrixDetail>(recordPath(entity, id))).data,
  addComment: async (entity: BitrixEntity, id: string, text: string): Promise<{ id: string }> =>
    (await api.post<{ id: string }>(`${recordPath(entity, id)}/comments`, { text })).data,
  connect: async (webhookUrl: string): Promise<{ status: string; account: BitrixAccount }> =>
    (await api.post<{ status: string; account: BitrixAccount }>(`${BASE}/connect`, { webhook_url: webhookUrl })).data,
  disconnect: async (): Promise<void> => {
    await api.post(`${BASE}/disconnect`);
  },
};
