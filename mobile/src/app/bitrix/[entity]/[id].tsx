import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StagePill } from '@/components/bitrix';
import { Avatar, Button, Card, ErrorView, ListSkeleton, Separator } from '@/components/ui';
import {
  api,
  errorMessage,
  type BitrixComment,
  type BitrixDealDetail,
  type BitrixEntity,
  type BitrixLeadDetail,
} from '@/lib/api';
import { formatMoney, fullDate } from '@/lib/format';
import { useColors } from '@/lib/theme';

type Detail = BitrixDealDetail | BitrixLeadDetail;

type FieldRow = { label: string; value?: string | null; href?: string };

function isEntity(value: string | undefined): value is BitrixEntity {
  return value === 'deals' || value === 'leads';
}

function dealRows(d: BitrixDealDetail): FieldRow[] {
  return [
    { label: 'Stage', value: d.stage_name || d.stage_id },
    { label: 'Amount', value: formatMoney(d.opportunity, d.currency) },
    { label: 'Contact', value: d.contact_name },
    { label: 'Company', value: d.company_title },
    { label: 'Responsible', value: d.assigned_name },
    { label: 'Created', value: fullDate(d.date_create) },
    { label: 'Modified', value: fullDate(d.date_modify) },
  ];
}

function leadRows(l: BitrixLeadDetail): FieldRow[] {
  return [
    { label: 'Status', value: l.status_name || l.status_id },
    { label: 'Name', value: l.name },
    { label: 'Phone', value: l.phone, href: l.phone ? `tel:${l.phone.replace(/[^\d+]/g, '')}` : undefined },
    { label: 'Email', value: l.email, href: l.email ? `mailto:${l.email}` : undefined },
    { label: 'Amount', value: formatMoney(l.opportunity, l.currency) },
    { label: 'Source', value: l.source },
    { label: 'Responsible', value: l.assigned_name },
    { label: 'Created', value: fullDate(l.date_create) },
    { label: 'Modified', value: fullDate(l.date_modify) },
  ];
}

export default function BitrixDetailScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ entity: string; id: string }>();
  const entity = isEntity(params.entity) ? params.entity : null;
  const id = params.id ?? '';
  const path = entity ? `/api/v1/connectors/bitrix24/${entity}/${encodeURIComponent(id)}` : '';
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const query = useQuery({
    queryKey: ['bitrix', entity, 'detail', id],
    enabled: !!entity && !!id,
    queryFn: async () => (await api.get<Detail>(path)).data,
  });

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api.post<{ id: string }>(`${path}/comments`, { text });
      setDraft('');
      await query.refetch();
    } catch (e) {
      Alert.alert('Comment not added', errorMessage(e));
    } finally {
      setSending(false);
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
      Linking.openURL(url).catch((e) => Alert.alert('Bitrix24', errorMessage(e, 'Could not open the link')));
    }
  };

  const header = <Stack.Screen options={{ title: '' }} />;

  if (!entity)
    return (
      <>
        {header}
        <ErrorView message="Unknown CRM record type." />
      </>
    );
  if (query.isLoading)
    return (
      <>
        {header}
        <ListSkeleton count={4} avatar={false} />
      </>
    );
  if (query.isError && !query.data)
    return (
      <>
        {header}
        <ErrorView message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      </>
    );

  const record = query.data;
  if (!record) return header;

  const isDeal = entity === 'deals';
  const rows = (isDeal ? dealRows(record as BitrixDealDetail) : leadRows(record as BitrixLeadDetail)).filter(
    (row) => !!row.value,
  );
  const stageLabel = isDeal
    ? (record as BitrixDealDetail).stage_name || (record as BitrixDealDetail).stage_id
    : (record as BitrixLeadDetail).status_name || (record as BitrixLeadDetail).status_id;
  const amount = formatMoney(record.opportunity, record.currency);
  const comments = record.comments ?? [];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
    >
      {header}
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
          <Text style={[styles.kind, { color: c.muted }]}>
            {isDeal ? 'Deal' : 'Lead'} #{record.id}
          </Text>
          <Text style={[styles.title, { color: c.text }]} selectable>
            {record.title || (isDeal ? '(untitled deal)' : '(untitled lead)')}
          </Text>
          <View style={styles.headline}>
            <View style={{ flexShrink: 1, marginRight: 8 }}>
              <StagePill label={stageLabel} />
            </View>
            {amount ? <Text style={[styles.amount, { color: c.text }]}>{amount}</Text> : null}
          </View>
        </View>

        <Card style={{ paddingVertical: 4 }}>
          {rows.map((row, index) => (
            <View key={row.label}>
              {index > 0 ? <Separator /> : null}
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: c.muted }]}>{row.label}</Text>
                {row.href ? (
                  <Text
                    style={[styles.fieldValue, { color: c.primary }]}
                    onPress={() => void Linking.openURL(row.href!).catch(() => {})}
                  >
                    {row.value}
                  </Text>
                ) : (
                  <Text style={[styles.fieldValue, { color: c.text }]} selectable>
                    {row.value}
                  </Text>
                )}
              </View>
            </View>
          ))}
          {record.comments_text ? (
            <View>
              {rows.length > 0 ? <Separator /> : null}
              <View style={styles.notes}>
                <Text style={[styles.fieldLabel, { color: c.muted }]}>Notes</Text>
                <Text style={[styles.notesText, { color: c.text }]} selectable>
                  {record.comments_text.trim()}
                </Text>
              </View>
            </View>
          ) : null}
        </Card>

        {record.url ? (
          <Button
            title="Open in Bitrix24"
            icon="open-outline"
            variant="secondary"
            onPress={() => void openInPortal(record.url)}
          />
        ) : null}

        <Text style={[styles.section, { color: c.text }]}>
          Comments{comments.length ? ` (${comments.length})` : ''}
        </Text>
        {comments.length === 0 ? (
          <Text style={{ color: c.muted, fontSize: 14 }}>No comments yet.</Text>
        ) : (
          comments.map((comment) => <CommentCard key={comment.id} comment={comment} />)
        )}
      </ScrollView>

      <View
        style={[
          styles.composer,
          {
            backgroundColor: c.card,
            borderTopColor: c.border,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a comment"
          placeholderTextColor={c.muted}
          multiline
          editable={!sending}
          style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
        />
        <TouchableOpacity
          onPress={() => void send()}
          disabled={!draft.trim() || sending}
          style={[styles.send, { backgroundColor: c.primary, opacity: !draft.trim() || sending ? 0.5 : 1 }]}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="arrow-up" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function CommentCard({ comment }: { comment: BitrixComment }) {
  const c = useColors();
  const author = comment.author_name || 'Bitrix24 user';
  return (
    <Card style={{ padding: 12 }}>
      <View style={styles.commentMeta}>
        <Avatar name={author} size={28} />
        <Text style={[styles.commentAuthor, { color: c.text }]} numberOfLines={1}>
          {author}
        </Text>
        <Text style={[styles.commentDate, { color: c.muted }]}>{fullDate(comment.created)}</Text>
      </View>
      <Text style={[styles.commentText, { color: c.text }]} selectable>
        {(comment.text ?? '').trim()}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  kind: { fontSize: 13, fontWeight: '500' },
  title: { fontSize: 22, fontWeight: '700', marginTop: 2 },
  headline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  amount: { fontSize: 18, fontWeight: '700' },
  field: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 11 },
  fieldLabel: { fontSize: 14, width: 110 },
  fieldValue: { fontSize: 15, flex: 1, textAlign: 'right' },
  notes: { paddingVertical: 11 },
  notesText: { fontSize: 15, lineHeight: 21, marginTop: 4 },
  section: { fontSize: 17, fontWeight: '700', marginTop: 8 },
  commentMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  commentAuthor: { fontSize: 14, fontWeight: '600', flex: 1, marginLeft: 8, marginRight: 8 },
  commentDate: { fontSize: 12 },
  commentText: { fontSize: 15, lineHeight: 21 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});
