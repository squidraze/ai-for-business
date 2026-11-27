import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Keyboard, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AsyncState } from '@/components/AsyncState';
import { FeatureBoundary } from '@/components/FeatureBoundary';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TERTIARY_LABEL_TEXT } from '@/lib/screen';
import { useColors } from '@/lib/theme';

import { ConnectorCardSkeleton } from './components';
import { invalidateConnectors, useConnectors } from './connectors.hooks';
import { CONNECTORS } from './registry';
import { ConnectorsScrollContext } from './scrollContext';

/** The Connectors tab: one card per integration from the registry. */
export function ConnectorsPage() {
  const c = useColors();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useConnectors();
  const [refreshing, setRefreshing] = useState(false);
  // A deep link back here (e.g. the Google OAuth redirect) carries params.
  const paramsKey = JSON.stringify(useLocalSearchParams());

  const refresh = useCallback(() => invalidateConnectors(queryClient), [queryClient]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // Coming back from the OAuth browser (or the deep link): re-read the status.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (paramsKey !== '{}') void refresh();
  }, [paramsKey, refresh]);

  // A field at the bottom (the webhook URL) is covered by the keyboard: once the
  // keyboard is up and the window has resized, scroll it into view.
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollContext = useMemo(
    () => ({
      revealEnd: () => {
        const sub = Keyboard.addListener('keyboardDidShow', () => {
          sub.remove();
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
        });
        setTimeout(() => sub.remove(), 1500);
      },
    }),
    [],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const statuses = query.data ?? [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <View className="pb-2 pt-5">
        <ScreenHeader title={t('tabs.connectors')} />
      </View>
      <AsyncState
        query={query}
        skeleton={<ConnectorCardSkeleton count={CONNECTORS.length} />}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
      >
        <ConnectorsScrollContext.Provider value={scrollContext}>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, gap: 16 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void onRefresh()}
                tintColor={c.primary}
                colors={[c.primary]}
              />
            }
          >
            <Text className={`text-sm ${TERTIARY_LABEL_TEXT}`}>{t('connectors.intro')}</Text>
            {CONNECTORS.map(({ id, Card }) => (
              <FeatureBoundary key={id} name={`connectors/${id}`} onReset={() => void query.refetch()}>
                <Card status={statuses.find((item) => item?.id === id)} />
              </FeatureBoundary>
            ))}
          </ScrollView>
        </ConnectorsScrollContext.Provider>
      </AsyncState>
    </SafeAreaView>
  );
}
