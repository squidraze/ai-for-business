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

### Переход

Сейчас код ещё в старом виде: `backend/app/connectors/` (по файлу на
интеграцию, общий `router.py` и `models.py`), инструменты всех интеграций в
`backend/app/ai/tools.py`, экраны с логикой прямо в `mobile/src/app/<name>/`,
методы всех интеграций в `mobile/src/lib/api.ts`, чат в `mobile/src/webchat/`. **Новые интеграции сразу пишем по новой схеме.**
Существующие (Telegram, Gmail, Bitrix24) переносим отдельной задачей, по одной
интеграции за раз, без изменения поведения.

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
