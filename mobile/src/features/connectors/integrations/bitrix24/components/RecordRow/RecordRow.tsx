import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';

import { formatMoney, joinParts, relativeTime } from '@/lib/format';
import { LABEL_TEXT, TERTIARY_LABEL_TEXT } from '@/lib/screen';

import type { BitrixDeal, BitrixEntity, BitrixLead, BitrixRecord } from '../../bitrix24.api';
import { StagePill } from '../StagePill';

/** One deal or lead in the CRM list. */
export function RecordRow({
  entity,
  record,
  onPress,
}: {
  entity: BitrixEntity;
  record: BitrixRecord;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity activeOpacity={0.6} className="px-4 py-3" onPress={onPress}>
      {entity === 'deals' ? <DealLines deal={record as BitrixDeal} /> : <LeadLines lead={record as BitrixLead} />}
    </TouchableOpacity>
  );
}

function DealLines({ deal }: { deal: BitrixDeal }) {
  const { t } = useTranslation();
  const amount = formatMoney(deal.opportunity, deal.currency);
  const party = joinParts([deal.contact_name, deal.company_title], ' · ');
  return (
    <>
      <View className="flex-row items-center justify-between">
        <Text className={`mr-2 flex-1 text-[15px] font-semibold ${LABEL_TEXT}`} numberOfLines={1}>
          {deal.title || t('bitrix.untitledDeal')}
        </Text>
        <Text className={`text-xs ${TERTIARY_LABEL_TEXT}`}>{relativeTime(deal.date_modify)}</Text>
      </View>
      <View className="mt-1.5 flex-row items-center justify-between">
        <View className="mr-2 shrink">
          <StagePill label={deal.stage_name || deal.stage_id} />
        </View>
        {amount ? <Text className={`text-sm font-semibold ${LABEL_TEXT}`}>{amount}</Text> : null}
      </View>
      {party ? (
        <Text className={`mt-1.5 text-[13px] ${TERTIARY_LABEL_TEXT}`} numberOfLines={1}>
          {party}
        </Text>
      ) : null}
    </>
  );
}

function LeadLines({ lead }: { lead: BitrixLead }) {
  const { t } = useTranslation();
  const person = joinParts([lead.name, lead.phone], ' · ');
  return (
    <>
      <View className="flex-row items-center justify-between">
        <Text className={`mr-2 flex-1 text-[15px] font-semibold ${LABEL_TEXT}`} numberOfLines={1}>
          {lead.title || t('bitrix.untitledLead')}
        </Text>
        <Text className={`text-xs ${TERTIARY_LABEL_TEXT}`}>
          {relativeTime(lead.date_modify ?? lead.date_create)}
        </Text>
      </View>
      <View className="mt-1.5 flex-row items-center">
        <StagePill label={lead.status_name || lead.status_id} />
      </View>
      {person ? (
        <Text className={`mt-1.5 text-[13px] ${TERTIARY_LABEL_TEXT}`} numberOfLines={1}>
          {person}
        </Text>
      ) : null}
    </>
  );
}
