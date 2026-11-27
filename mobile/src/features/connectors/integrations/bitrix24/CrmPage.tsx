import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { PageHeader } from '@/components/PageHeader';
import { PagerTabsView, type PagerTab } from '@/components/PagerTabs';
import { SearchInput } from '@/components/SearchInput';
import { useColors } from '@/lib/theme';
import { useDebounced } from '@/lib/useDebounced';

import { SEARCH_CONTAINER } from '../../components';
import type { BitrixEntity } from './bitrix24.api';
import { RecordList } from './components/RecordList';

const SEARCH_DEBOUNCE_MS = 400;
const ENTITIES: BitrixEntity[] = ['deals', 'leads'];

/** Bitrix24 CRM: deals and leads on swipeable tabs, searched by title. */
export function BitrixCrmPage() {
  const c = useColors();
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS).trim();
  const isSearchPending = search.trim() !== debouncedSearch;
  const entity = ENTITIES[index] ?? 'deals';

  const tabs: PagerTab[] = [
    { id: 'deals', label: t('bitrix.deals') },
    { id: 'leads', label: t('bitrix.leads') },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title={t('bitrix.title')}>
        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder={entity === 'deals' ? t('bitrix.searchDeals') : t('bitrix.searchLeads')}
          autoCapitalize="none"
          autoCorrect={false}
          containerClassName={SEARCH_CONTAINER}
        />
      </PageHeader>
      <PagerTabsView
        tabs={tabs}
        activeIndex={index}
        onIndexChange={setIndex}
        tabsContainerClassName="px-3.5 pb-2"
        renderPage={(tab) => (
          <RecordList
            entity={tab.id as BitrixEntity}
            search={debouncedSearch}
            searchPending={isSearchPending}
          />
        )}
      />
    </View>
  );
}
