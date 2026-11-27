import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ExternalLink } from 'lucide-react-native';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { AsyncState } from '@/components/AsyncState';
import { FeatureBoundary } from '@/components/FeatureBoundary';
import { PageHeader } from '@/components/PageHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SkeletonList } from '@/components/Skeleton';
import { ErrorView } from '@/components/StateView';
import { errorMessage } from '@/lib/api';
import { formatMoney, fullDate } from '@/lib/format';
import { CARD_SURFACE, LABEL_TEXT, TERTIARY_LABEL_TEXT } from '@/lib/screen';
import { useColors } from '@/lib/theme';

import { ComposerBar, NotConnected, RowDivider } from '../../components';
import { isNotConnectedError } from '../../errors';
import {
  isBitrixEntity,
  type BitrixDealDetail,
  type BitrixDetail,
  type BitrixEntity,
  type BitrixLeadDetail,
} from './bitrix24.api';
import { useAddBitrixComment, useBitrixRecord } from './bitrix24.hooks';
import { BITRIX24_NAME } from './components/Bitrix24ConnectorCard';
import { CommentCard } from './components/CommentCard';
import { StagePill } from './components/StagePill';

type FieldRow = { key: string; label: string; value?: string | null; href?: string };

function dealRows(d: BitrixDealDetail, t: TFunction): FieldRow[] {
  return [
    { key: 'stage', label: t('bitrix.fields.stage'), value: d.stage_name || d.stage_id },
    { key: 'amount', label: t('bitrix.fields.amount'), value: formatMoney(d.opportunity, d.currency) },
    { key: 'contact', label: t('bitrix.fields.contact'), value: d.contact_name },
    { key: 'company', label: t('bitrix.fields.company'), value: d.company_title },
    { key: 'responsible', label: t('bitrix.fields.responsible'), value: d.assigned_name },
    { key: 'created', label: t('bitrix.fields.created'), value: fullDate(d.date_create) },
    { key: 'modified', label: t('bitrix.fields.modified'), value: fullDate(d.date_modify) },
  ];
}

function leadRows(l: BitrixLeadDetail, t: TFunction): FieldRow[] {
  const phone = typeof l.phone === 'string' ? l.phone : null;
  const email = typeof l.email === 'string' ? l.email : null;
  return [
    { key: 'status', label: t('bitrix.fields.status'), value: l.status_name || l.status_id },
    { key: 'name', label: t('bitrix.fields.name'), value: l.name },
    {
      key: 'phone',
      label: t('bitrix.fields.phone'),
      value: phone,
      href: phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined,
    },
    { key: 'email', label: t('bitrix.fields.email'), value: email, href: email ? `mailto:${email}` : undefined },
    { key: 'amount', label: t('bitrix.fields.amount'), value: formatMoney(l.opportunity, l.currency) },
    { key: 'source', label: t('bitrix.fields.source'), value: l.source },
    { key: 'responsible', label: t('bitrix.fields.responsible'), value: l.assigned_name },
    { key: 'created', label: t('bitrix.fields.created'), value: fullDate(l.date_create) },
    { key: 'modified', label: t('bitrix.fields.modified'), value: fullDate(l.date_modify) },
  ];
}

/** One deal or lead: fields, link to the portal, comments and a comment box. */
export function BitrixRecordPage() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ entity: string; id: string }>();
  const entity = isBitrixEntity(params.entity) ? params.entity : null;
  const id = params.id ?? '';

  if (!entity)
    return (
      <View style={{ flex: 1 }}>
        <PageHeader title={BITRIX24_NAME} />
        <ErrorView message={t('bitrix.unknownType')} />
      </View>
    );

  return <RecordScreen entity={entity} id={id} />;
}

function RecordScreen({ entity, id }: { entity: BitrixEntity; id: string }) {
  const c = useColors();
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const query = useBitrixRecord(entity, id);
  const addComment = useAddBitrixComment(entity, id);
  const isDeal = entity === 'deals';
  const kind = isDeal ? t('bitrix.deal', { id }) : t('bitrix.lead', { id });

  const send = async () => {
    const text = draft.trim();
    if (!text || addComment.isPending) return;
    try {
      await addComment.mutateAsync(text);
      setDraft('');
    } catch (e) {
      Alert.alert(t('bitrix.commentNotAdded'), errorMessage(e));
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const openInPortal = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Linking.openURL(url).catch((e) =>
        Alert.alert(BITRIX24_NAME, errorMessage(e, t('bitrix.openFailed'))),
      );
    }
  };

  const renderDetail = (record: BitrixDetail) => {
    const rows = (isDeal ? dealRows(record as BitrixDealDetail, t) : leadRows(record as BitrixLeadDetail, t)).filter(
      (row) => !!row.value,
    );
    const stageLabel = isDeal
      ? (record as BitrixDealDetail).stage_name || (record as BitrixDealDetail).stage_id
      : (record as BitrixLeadDetail).status_name || (record as BitrixLeadDetail).status_id;
    const amount = formatMoney(record.opportunity, record.currency);
    const comments = Array.isArray(record.comments) ? record.comments : [];
    const notes = typeof record.comments_text === 'string' ? record.comments_text.trim() : '';

    return (
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      >
        <View>
          <Text className={`text-[22px] font-bold ${LABEL_TEXT}`} selectable>
            {record.title || (isDeal ? t('bitrix.untitledDeal') : t('bitrix.untitledLead'))}
          </Text>
          <View className="mt-2 flex-row items-center justify-between">
            <View className="mr-2 shrink">
              <StagePill label={stageLabel} />
            </View>
            {amount ? <Text className={`text-lg font-bold ${LABEL_TEXT}`}>{amount}</Text> : null}
          </View>
        </View>

        {rows.length > 0 || notes ? (
          <View className={`${CARD_SURFACE} px-4 py-1`}>
            {rows.map((row, index) => (
              <View key={row.key}>
                {index > 0 ? <RowDivider /> : null}
                <View className="flex-row items-start py-[11px]">
                  <Text className={`w-[110px] text-sm ${TERTIARY_LABEL_TEXT}`}>{row.label}</Text>
                  {row.href ? (
                    <Text
                      className="flex-1 text-right text-[15px] text-primary"
                      onPress={() => void Linking.openURL(row.href!).catch(() => {})}
                    >
                      {row.value}
                    </Text>
                  ) : (
                    <Text className={`flex-1 text-right text-[15px] ${LABEL_TEXT}`} selectable>
                      {row.value}
                    </Text>
                  )}
                </View>
              </View>
            ))}
            {notes ? (
              <View>
                {rows.length > 0 ? <RowDivider /> : null}
                <View className="py-[11px]">
                  <Text className={`text-sm ${TERTIARY_LABEL_TEXT}`}>{t('bitrix.fields.notes')}</Text>
                  <Text className={`mt-1 text-[15px] leading-[21px] ${LABEL_TEXT}`} selectable>
                    {notes}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {record.url ? (
          <PrimaryButton
            size="md"
            label={t('bitrix.openInPortal')}
            icon={ExternalLink}
            onPress={() => void openInPortal(record.url)}
            colorClassName="bg-zinc-200 dark:bg-zinc-800"
            textClassName="text-zinc-800 dark:text-zinc-50"
            iconColor={c.text}
          />
        ) : null}

        <Text className={`mt-2 text-[17px] font-bold ${LABEL_TEXT}`}>
          {comments.length ? t('bitrix.commentsCount', { count: comments.length }) : t('bitrix.comments')}
        </Text>
        {comments.length === 0 ? (
          <Text className={`text-sm ${TERTIARY_LABEL_TEXT}`}>{t('bitrix.noComments')}</Text>
        ) : (
          comments.map((comment) => <CommentCard key={comment.id} comment={comment} />)
        )}
      </ScrollView>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeader title={kind} />
      <FeatureBoundary name="bitrix24/record" onReset={() => void query.refetch()} resetKey={`${entity}/${id}`} fullScreen>
        <AsyncState
          query={query}
          skeleton={<SkeletonList count={4} avatar={false} />}
          error={(error) =>
            isNotConnectedError(error) ? <NotConnected name={BITRIX24_NAME} message={errorMessage(error)} /> : null
          }
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
        >
          {() => (query.data ? renderDetail(query.data) : null)}
        </AsyncState>
      </FeatureBoundary>
      {query.data ? (
        <ComposerBar
          value={draft}
          onChangeText={setDraft}
          onSend={() => void send()}
          sending={addComment.isPending}
          placeholder={t('bitrix.commentPlaceholder')}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}
