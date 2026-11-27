@docs/for-promt/for-promt.md

## Архитектура: модульные интеграции

Интеграций будет много (Telegram, Instagram, Gmail и другие сервисы Google,
WhatsApp, Bitrix24, amoCRM, BILLZ, МойСклад, 1С…), и каждая быстро
разрастается. Поэтому **каждая интеграция — отдельный модуль в своей папке**,
и в бэкенде, и в мобилке. Код одной интеграции не лежит в общих файлах и не
импортирует код другой интеграции.

### Бэкенд: `backend/app/integrations/<name>/`

```
backend/app/integrations/
  __init__.py      # реестр: список всех интеграций, ничего больше
  base.py          # общий контракт интеграции и общие помощники
  errors.py        # общие ошибки (нет подключения, ошибка провайдера)
  telegram/
    __init__.py    # объект интеграции: id, название, router, tools, status()
    client.py      # работа с API провайдера (Telethon, Graph API, REST…)
    router.py      # HTTP-эндпоинты /connectors/telegram/...
    tools.py       # инструменты для ИИ + summary для карточки подтверждения
    models.py      # таблицы этой интеграции (сессия, токены)
    schemas.py     # pydantic-модели запросов и ответов
  gmail/
  bitrix24/
  instagram/
  ...
```

Правила:

- `app/ai/` (runner, tools) **не знает про конкретные интеграции**: он берёт
  инструменты и статус подключения из реестра `integrations/__init__.py`.
  Никаких `if name == "telegram"` и словарей с названиями интеграций в `ai/`.
- `main.py` подключает роутеры интеграций циклом по реестру.
- Каждый инструмент, который что-то отправляет или меняет, объявляется в
  `tools.py` интеграции как требующий подтверждения (`PendingAction`) и
  имеет summary для карточки. Это проверяется при ревью.
- Общий код (шифрование секретов, HTTP-клиент с ретраями, пагинация,
  обрезка длинных ответов для ИИ) — в `integrations/base.py` или `app/lib/`,
  а не копией в каждой папке.
- Добавить интеграцию = создать новую папку и одну строку в реестре. Удалить
  интеграцию = удалить папку и строку. Если для этого нужно править другие
  файлы, значит, модульность нарушена.

### Мобилка: `mobile/src/features/<feature>/`

Фичи по образцу `D:\rooler\mobile-apps\apps\shiptrack` (`src/features/...`).
Интеграции — внутри фичи коннекторов:

```
mobile/src/
  app/                          # только маршруты expo-router, тонкие файлы
  components/                   # общие UI-компоненты всего приложения
  lib/                          # api-клиент, auth, theme, format, общие хуки
  features/
    chat/                       # экран чата (WebView), мост, обработчики
    auth/                       # вход и регистрация
    profile/
    connectors/
      ConnectorsPage.tsx        # вкладка «Коннекторы»
      components/               # компоненты страницы коннекторов (ConnectorCard/ ...)
      registry.ts               # реестр: карточки интеграций (иконка, название, статус, экран)
      index.ts                  # публичный API фичи
      integrations/
        telegram/
          index.ts              # публичный API интеграции: страницы + описание для реестра
          telegram.api.ts       # запросы к /connectors/telegram/... и типы
          telegram.hooks.ts     # TanStack Query хуки
          ChatsPage.tsx         # страницы интеграции
          ChatPage.tsx
          ConnectPage.tsx
          components/           # компоненты только этой интеграции
            DialogRow/
              DialogRow.tsx
              index.ts
        gmail/
        bitrix24/
        instagram/
        ...
```

Правила:

- expo-router требует, чтобы маршруты лежали в `src/app/`. Файлы маршрутов
  там остаются **тонкими**: импортируют страницу из публичного `index.ts` фичи
  и рендерят её, без логики и разметки.

  ```tsx
  // src/app/telegram/index.tsx
  import { TelegramChatsPage } from '@/features/connectors/integrations/telegram';
  export default function TelegramChatsScreen() {
    return <TelegramChatsPage />;
  }
  ```

- Импортируем фичу и интеграцию только через её `index.ts`, не лезем во
  внутренние файлы. Интеграции не импортируют друг друга.
- Общее для всех интеграций (карточка коннектора, экран «не подключено»,
  поле с вебхуком) — в `features/connectors/components/`. Общее для всего
  приложения — в `src/components/`.
- `src/lib/api.ts` содержит только общий axios-клиент, авторизацию и
  обработку ошибок. Методы и типы интеграций — в `<name>.api.ts`.
- Вкладка «Коннекторы» строит список из `features/connectors/registry.ts`,
  а не из захардкоженного списка.
- Компонент — папка `ComponentName/` с `ComponentName.tsx` и `index.ts`.
- Каждый экран сразу в светлой и тёмной теме (`src/lib/theme.ts`).

### Веб-чат (`webview/`)

Если интеграции нужен свой вид в чате (особая карточка подтверждения,
превью письма, карточка сделки), он лежит в `webview/src/integrations/<name>/`,
а не в общих файлах `chat/`.

### Текущее состояние

Telegram, Gmail и Bitrix24 уже перенесены на новую схему: бэкенд —
`backend/app/integrations/{telegram,gmail,bitrix24}/`, мобилка —
`mobile/src/features/connectors/integrations/{telegram,gmail,bitrix24}/`, чат —
`mobile/src/features/chat/`. Старых `backend/app/connectors/` и
`mobile/src/webchat/` и `mobile/src/components/ui.tsx` больше нет.

## Состояния экрана: loading / error / empty / content

Любые данные, которые грузятся по сети, всегда обрабатываются в четырёх
состояниях — и на бэкенде, и на фронте (мобилка, веб-чат). Экран или блок без
одного из них считается недоделанным и не проходит ревью.

### Бэкенд

- Ошибки отдаются в едином формате через `app/lib/errors.py`
  (`ApiError` → `{"detail": {"code", "message", "field"}}`). Новый код ошибки
  добавляется в `MESSAGES`, фронт переключается по `code`, а не по тексту.
- Ошибки провайдера (Telegram, Google, Bitrix24…) ловятся в интеграции и
  превращаются в `ApiError` с понятным кодом (`<name>_unavailable`,
  `<name>_not_connected` и т. п.), а не улетают голым 500 со стектрейсом.
- Пустой результат — это успешный ответ с пустым списком (`200`, `[]` /
  `{"items": []}`), а не `404` и не `null`. `404` — только когда не найден
  конкретный объект по id.
- Инструменты ИИ тоже различают «пусто» и «ошибка»: возвращают модели явный
  текст («чатов не найдено» / «Telegram не подключён»), а не пустую строку
  или исключение.
- **Ни один запрос не висит бесконечно.** Каждый вызов внешнего сервиса — с
  явным коротким таймаутом (httpx `timeout=`, у Telethon — `timeout` и
  `connection_retries`), таймаут превращается в `ApiError` (`<name>_unavailable`).
  Страховка сверху — `app/lib/timeouts.py`: после `REQUEST_TIMEOUT_SECONDS`
  (30 с) сервер сам отвечает `504 request_timeout`. Законно долгие запросы
  (загрузка файлов) добавляются в `EXEMPT_PREFIXES`, остальное — не исключение.

### Фронт (мобилка и веб-чат)

- **Loading** — по возможности скелетон с анимацией мерцания, повторяющий
  форму контента, а не спиннер посреди экрана. В мобилке —
  `src/components/Skeleton` (`Skeleton`, `SkeletonList`), в веб-чате —
  скелетоны из `src/ui/primitives` (`ChatSkeleton`). Спиннер — только для
  коротких действий (нажатие кнопки, отправка).
- **Error** — всегда с текстом ошибки (через переводы, по `code`) и кнопкой
  **Retry**, которая перезапрашивает данные (`refetch`). Ошибка без способа
  повторить недопустима. Если данные уже были, а упал повторный запрос —
  оставляем старые данные и показываем тост/плашку, а не затираем экран.
- **Empty** — отдельный экран с иконкой, понятным текстом и, где уместно,
  действием («Подключить Telegram», «Начать чат»). Пустой белый экран или
  пустой список без подписи недопустимы.
- **Loading всегда заканчивается.** Запросы идут через общий `api` из
  `src/lib/api.ts` с таймаутом `EXPO_PUBLIC_API_TIMEOUT_MS` (15 с); свой
  таймаут больше общего — только для загрузки файлов (`UPLOAD_TIMEOUT_MS`).
  Повторы — только через `shouldRetryRequest` (один раз при обрыве сети или
  502/503, таймаут и 4xx не повторяются). Через `SLOW_LOADING_MS` (8 с)
  `AsyncState` показывает «Загрузка занимает больше обычного». Итого скелетон
  максимум ~15 с, дальше — ошибка с Retry. Не ставь `retry: true`,
  `timeout: 0` и не делай своих бесконечных polling-циклов без остановки.
- **Content** — переходы между состояниями плавные (кросс-фейд).
- В мобилке для этого есть готовое: `src/components/AsyncState`
  (`resolveAsyncState` + разметка всех состояний), `FadeSwitch`, `StateView`
  (`ErrorView` с `onRetry`). Используй их, а не пиши состояния заново на
  каждом экране. Pull-to-refresh на списках.
- Длительности анимаций не хардкодим — берём из env (см.
  `mobile/.env.example`, читаются в `src/lib/config.ts`):
  - `EXPO_PUBLIC_STATE_FADE_MS` — кросс-фейд между состояниями (по умолчанию 800);
  - `EXPO_PUBLIC_SKELETON_SHIMMER_MS` — один проход мерцания скелетона (по умолчанию 1200);
  - `EXPO_PUBLIC_SHEET_OPEN_MS` / `EXPO_PUBLIC_SHEET_CLOSE_MS` — шторка (300 / 250);
  - `EXPO_PUBLIC_DIALOG_FADE_MS` — диалог `PermissionDialog` (180);
  - `EXPO_PUBLIC_SEGMENT_SLIDE_MS` — «таблетка» `SegmentedSwitch` (260);
  - `EXPO_PUBLIC_SWITCH_TOGGLE_MS` — тумблер `AnimatedSwitch` (300).
  Новое значение анимации — новая переменная в `.env.example` с комментарием
  и дефолтом в `config.ts`.
- Все состояния — в светлой и тёмной теме.

### Error boundary

- Всегда должен быть error boundary: падение одного компонента не роняет
  приложение целиком.
- Веб-чат: корень обёрнут в `ErrorBoundary` из `src/ui/primitives`
  (`App.tsx`), каждое сообщение — в свой boundary (`MessageList.tsx`). Новые
  самостоятельные блоки (карточки интеграций в `webview/src/integrations/`,
  генеративные блоки) тоже оборачиваются в свой boundary.
- Мобилка: корневой boundary на всё приложение плюс boundary на каждый экран
  (в expo-router — `export { ErrorBoundary }` из файла маршрута или общий
  компонент из `src/components/ErrorBoundary`). Fallback boundary — экран
  ошибки с кнопкой Retry (сбросить boundary и перезапросить данные), в обеих
  темах, тексты через переводы.

- **Секции тоже под boundary.** Каждый блок экрана, который рисует данные с
  бэкенда, оборачивается в `FeatureBoundary` (`src/components/FeatureBoundary`):
  `name="feature/section"`, `onReset={query.refetch}`, `resetKey` — когда ошибка
  должна сбрасываться при смене данных (выбранный id), `fullScreen` — когда
  обёрнутое дерево занимает весь экран. Boundary маршрута — последний рубеж, он
  теряет весь экран.
- **Boundary не заменяет `isError`.** Он ловит только исключения при рендере.
  Упавший запрос — это значение, а не throw: ветки loading → error → empty →
  content остаются. Обработчики (`onPress`), таймеры и async-код — обычный
  try/catch + `reportError`.
- **Не вызывай методы строк/массивов/чисел прямо на полях из API**
  (`name.charAt(0)`, `items.map`, `amount.toFixed`). Поле, которое бэкенд
  перестал присылать, роняет рендер. Только через null-safe помощники из
  `src/lib/format.ts` (`initials`, `relativeTime`, `fullDate`, `formatMoney`…),
  которые рисуют `—`. Нужен новый — добавь туда, а не копию в фичу.

### Поиск и фильтры

- Со сменой запроса скелетон возвращается, и сразу с первого символа, а не когда
  уйдёт запрос. Флаг ожидания считаем от debounce (`useDebounced` из
  `src/lib/useDebounced.ts`):

  ```tsx
  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS);
  const isSearchPending = search.trim() !== debouncedSearch.trim();
  const showSkeleton = isLoading || isSearchPending;
  ```

### Pull-to-refresh: с первого дня, только нативный

- Любой экран с данными с бэкенда тянется для обновления сразу, не только
  списки, но и `ScrollView` из нескольких секций. Обработчик — прямо `refetch`;
  несколько запросов на экране — свой флаг `refreshing` и
  `await Promise.all([a.refetch(), b.refetch()])`, спиннер держим, пока не
  закончатся все.
- **Только нативный `RefreshControl` на обеих ОС** (`tintColor` и `colors` из
  `useColors()`, не захардкоженным цветом). Своих жестовых «пуллов» нет. Поэтому
  страницы с табами — только на нативном пейджере (`PagerTabsView` на
  `react-native-pager-view`), а не на ряду, сдвинутом через transform: под
  transform-предком Android-овский SwipeRefreshLayout ломается.
- Пустой экран тоже тянется: `EmptyView` — это `ListEmptyComponent` списка с
  `contentContainerStyle={{ flexGrow: 1 }}`, а не ранний `return` над списком.
  loading и error могут оставаться ранним `return`.

## Мобилка: общие UI-компоненты

Общие компоненты перенесены из `D:\rooler\mobile-apps\packages\ui` и лежат в
`mobile/src/components/<Name>/`. Стиль — **NativeWind** (`className`, Tailwind 3),
анимации и жесты — **react-native-reanimated** и
**react-native-gesture-handler**, иконки — **lucide-react-native** (в пропсы
передаётся компонент иконки: `icon={Plus}`). Токены классов и цветов для них —
`src/lib/screen.ts` (`LABEL_TEXT`, `INSET_SURFACE`, `CARD_SURFACE`,
`useLabelColors()` …), бренд — `bg-primary` (CSS-переменные в
`mobile/global.css`, те же значения, что `primary` в `src/lib/theme.ts`).
Если меняешь бренд — меняй в обоих местах.

- **Любая кнопка-действие — `PrimaryButton`**: и плавающая «добавить», и
  «Готово»/«Отправить» в шторке. Свою `Pressable`-кнопку не собираем. Нейтральная
  или вторичная кнопка — тот же компонент с переопределениями под тему
  (`colorClassName`, `textClassName`, `iconColor`, у каждого пара `dark:`), чтобы
  совпадали высота, радиус и отклик на нажатие. Пропсы описаны в файле.
- **Обычные поля ввода — `AppTextInput`**, длинный текст — он же с `multiline`.
  Радиус, отступы, заливка и обе темы зашиты и не переопределяются; снаружи
  настраиваются только внешние отступы (`containerClassName`). Сырой `TextInput`
  допустим только в композере чата и в OTP.
- **Любое поле поиска — `SearchInput`**: 44px, радиус 16, кнопка очистки и
  смена приглушённого цвета на основной при вводе. Внешний вид не
  переопределяется (нет `iconSize`, `iconColor`, заливки) — именно через такие
  пропсы раньше вырастали пять разных полей поиска. `containerClassName` — только
  внешние отступы.
- **Сегментный переключатель — `PagerTabs`** (дорожка с радиусом 16, сегменты
  36px с радиусом 12, брендовая «таблетка», которая едет за позицией, волосяные
  разделители). Вид зафиксирован, `containerClassName` — только отступы. Два
  входа, один вид:
  - **переключает, что показывает экран** → `PagerTabsView`: табы над нативным
    пейджером. Это по умолчанию и без исключений: если по обе стороны контент,
    контент свайпается (тап по табу и свайп двигают одну и ту же позицию);
  - **задаёт значение** (фильтр в шторке, настройка) → `SegmentedSwitch`, тот же
    `PagerTabs` с позицией из `value`. Свайпать нечего — только поэтому он.
- **Тумблер вкл/выкл — `AnimatedSwitch`** (reanimated, цвета по умолчанию под
  обе темы, длительность из env). Не RN `Switch` и не свой.
- **Шапок ровно две, и выбор зависит от того, чем является экран:**
  - **`ScreenHeader`** — корень вкладки. Заголовок 28px, справа плитки
    `HeaderIconButton` 44px, без кнопки «назад». Safe-area не добавляет: корень
    вкладки уже лежит в своём `SafeAreaView edges={['top', …]}`.
  - **`PageHeader`** — всё, куда переходят. Шеврон «назад», заголовок 24px,
    необязательный приглушённый `subtitle`, максимум одно голое `action` 24px,
    `children` под заголовком (поиск, табы). `inlineTitle` ставит заголовок в
    строку с кнопками (без `subtitle`, это проверяет тип). Сам отступает от
    статус-бара, поэтому экран под ним **не** кладём в
    `SafeAreaView edges={['top']}` — иначе двойной отступ. Такой экран
    скрывает нативную шапку стека (`headerShown: false`).
  - Третью не пишем. Если не хватает — расширяем одну из двух.

### Шторки и выпадающие панели: всегда `SwipeableBottomSheet`

- **Любая шторка, bottom sheet и пикер в виде шторки — на
  `SwipeableBottomSheet`** (`@/components/SwipeableBottomSheet`). Не берём
  `@gorhom/bottom-sheet`, голый RN `Modal`, action sheet или самописную
  анимированную панель: одна реализация — одинаковые жесты, клавиатура,
  safe-area и темы.
- Флаг `isOpen` у родителя, в `onClose` родитель шторку размонтирует. Render-функция
  даёт `close`, который проигрывает анимацию закрытия:

  ```tsx
  <SwipeableBottomSheet isOpen={isOpen} onClose={() => setIsOpen(false)}>
    {({ close }) => <MyContent onDone={close} />}
  </SwipeableBottomSheet>
  ```

- Длинный контент или контент с полями ввода открываем с `fullHeight`.
- **Прокрутка внутри шторки — только через `useSheetScrollView()`.** Обычный
  `ScrollView` не прокрутится: жест шторки забирает каждое вертикальное
  движение. Прочитай
  [SwipeableBottomSheet.md](mobile/src/components/SwipeableBottomSheet/SwipeableBottomSheet.md),
  прежде чем класть список в шторку.
- Выбор одного варианта из короткого списка названий — `PickerSheet` (уже на
  `SwipeableBottomSheet`).
- **Запрос системного разрешения — не шторка**, а `PermissionDialog`: карточка
  с отступом 12px от нижних углов, круг 120px с иконкой (или картинкой через
  `image`), две строки текста и две равные `PrimaryButton size="xs"` —
  «Не сейчас» и «Разрешить». Это диалог, а не шторка намеренно: его нельзя
  смахнуть, потому что случайно смахнутый запрос повторяется при следующем
  запуске.

### NativeWind: что помнить

- Новые папки с `className` должны попадать в `content` в
  `mobile/tailwind.config.js` (сейчас `./src/**`), иначе в прод-сборке классы
  вырежутся, а в dev всё будет выглядеть нормально.
- `dark:` следует теме из «Профиль → Тема» (`src/lib/themeMode.ts`: система /
  тёмная / светлая, `darkMode: 'class'`) — тому же, что `useColors()`. Каждый
  класс цвета пишем парой `light dark:…` или берём токен из `src/lib/screen.ts`.
- Где класс не доходит (цвет иконки, `placeholderTextColor`, анимированный
  стиль) — значения из `useLabelColors()` / `useColors()`, не хекс в компоненте.
- Для `style` с функцией `({ pressed }) => …` бери `TouchableOpacity`:
  NativeWind оборачивает `Pressable` и может терять функциональную форму `style`.
- Ширину рамки между темами не меняем (`border border-transparent
  dark:border-zinc-800`, а не голый `dark:border`): на Android у обрезанного
  (`overflow: hidden`) блока со скруглением при живой смене темы пропадают
  дочерние элементы.
- После изменения `babel.config.js`, `metro.config.js`, `tailwind.config.js`
  или `global.css` перезапускай Metro с `--clear`. Новые нативные библиотеки —
  только через `npx expo install` и пересборку (`npm run android`).

## Git

Правила — в [docs/git/branches.md](docs/git/branches.md) (ветки, релизы,
hotfix, окружения) и [docs/git/commits.md](docs/git/commits.md) (формат
коммитов). Следуй им всегда. Коротко:

- Ветки: `main` (разработка, staging) и `prod` (продакшен, только через PR).
  Работа — в ветках `feat/…`, `fix/…`, `refactor/…`, `docs/…`, `chore/…`,
  `test/…`, `perf/…`, `build/…`, `ci/…` от `main`; `hotfix/…` — от `prod`.
- Коммиты: Conventional Commits на английском, `type(scope): summary`,
  первая строка до 72 символов. Не коммитить прямо в `main` и `prod`.
- Сливать в `main` с merge commit (`--no-ff`), ветку после слияния удалять.
- Релиз: PR `main` → `prod`, тег `vX.Y.Z` на `prod`.
- Хук `.githooks/commit-msg` проверяет формат; включается
  `git config core.hooksPath .githooks`.
