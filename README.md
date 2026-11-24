# forBusiness

Мобильное приложение — ИИ-ассистент, у которого есть доступ к твоему Telegram и Gmail.

Что умеет:

- **Чат с ИИ.** Ответ печатается по мере генерации. Можно прикладывать фото и файлы, перегенерировать ответ, редактировать свой вопрос, копировать ответ.
- **Список чатов.** Все разговоры с ИИ, новый чат, удаление.
- **Telegram.** Вход в свой аккаунт по номеру телефона (код и пароль 2FA, если включён). В приложении видны все чаты, история переписки и поиск, можно писать сообщения.
- **Gmail.** Подключение через Google. Входящие, поиск, чтение писем, ответ, новое письмо.
- **Bitrix24.** Сделки и лиды с поиском, карточка сделки, комментарии.
- **Регулярные задачи (Schedules).** Например: «каждый день в 10:00 найди в Telegram тех, кто обещал подумать, и спроси, решили ли они». В назначенное время бэкенд сам запускает ИИ с этим заданием в отдельном чате задачи (каждый запуск видит предыдущие, поэтому не дублирует). Отправка всё равно идёт через подтверждение; когда оно нужно (или запуск упал) — приходит push, по нажатию открывается чат задачи. Задачи можно создавать на экране задач или попросить ИИ в чате.
- **ИИ работает с коннекторами.** Например: «что мне писали в Telegram сегодня», «найди письмо от Ивана и ответь, что согласен», «переведи сделку с Ромашкой на этап „Успешна“», «создай лид из последнего письма». Перед отправкой сообщения или письма и перед любым изменением в CRM ИИ спрашивает подтверждение. Коннектор можно выключить для отдельного чата через «+» → Connectors.

## Запуск

Нужны Docker, Node.js 20+ и Android-телефон с включённой отладкой по USB.

### 1. Ключи

```bash
cp .env.example .env    # вписать ключи — что где взять, написано в самом файле
```

### 2. Бэкенд

```bash
docker compose up -d --build   # бэкенд (порт 8000) + сервер стрима ответов (порт 8001)
docker compose logs -f backend # логи
docker compose down            # остановить
```

Вход в приложение — почта + пароль с кодом подтверждения на почту, Google или Apple.
Письма с кодами уходят только через Gmail SMTP (`SMTP_USER` и пароль приложения Google в `SMTP_PASSWORD`, как получить — в `.env.example`).
Пока они пустые, письма не отправляются, а код виден в логах бэкенда:

```bash
docker compose logs -f backend | grep "dev mail"   # [dev mail] to=you@example.com purpose=verify code=123456
```

Вход через Google: в Google Cloud Console к Web-клиенту (он уже есть для Gmail) добавить Android-клиент (пакет `ai.forbusiness.demo` + SHA-1 из `cd mobile/android && ./gradlew signingReport`) и iOS-клиент (bundle `ai.forbusiness.demo`), их Client ID через запятую — в `GOOGLE_SIGNIN_CLIENT_IDS`. Вход через Apple проверяет токен по `APPLE_BUNDLE_ID` (по умолчанию `ai.forbusiness.demo`).

Регулярные задачи и пуши:

- Планировщик работает внутри бэкенда (один процесс), проверяет задачи каждые `SCHEDULER_TICK_SECONDS` секунд. Если бэкенд был выключен и запуски пропущены, после старта каждая такая задача выполнится один раз (не по разу за каждый пропуск), дальше — по расписанию.
- Если предыдущий запуск задачи ещё идёт или ждёт подтверждения, следующий пропускается (в истории — `skipped`).
- Пуши — через Firebase Cloud Messaging: `FCM_PROJECT_ID` и JSON-ключ сервисного аккаунта в `secrets/` (`FCM_SERVICE_ACCOUNT_FILE`), `google-services.json` — в `mobile/`. Пошагово — в `.env.example`. Пока ключа нет, пуши видны в логах:

```bash
docker compose logs -f backend | grep "dev push"   # [dev push] user=1 devices=1 title=... body=Нужно подтверждение: 1 действие data={...}
```

### 3. Мобилка

```bash
cd mobile
npm install
adb reverse tcp:8000 tcp:8000  # телефон видит бэкенд как localhost
adb reverse tcp:8001 tcp:8001  # повторять после каждого переподключения телефона
npx expo run:android           # соберёт и поставит приложение на телефон
```

Настройки мобилки — в `mobile/.env` (образец и комментарии в `mobile/.env.example`):

- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` — Web client ID из Google Cloud Console (тот же, что `GOOGLE_CLIENT_ID` бэкенда). Без него кнопка «Продолжить с Google» неактивна. Для Android в той же консоли нужен ещё клиент типа Android: пакет `ai.forbusiness.demo` + SHA-1 отладочного ключа (`cd android && ./gradlew signingReport`).
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` — только для iOS-сборки (`mobile/app.config.js` добавляет плагин Google Sign-In, только если схема задана). Вход через Apple есть только на iOS.
- `EXPO_PUBLIC_STATE_FADE_MS` (800) и `EXPO_PUBLIC_SKELETON_SHIMMER_MS` (1200) — длительность перехода между состояниями экрана и период «блика» скелетона.
- `EXPO_PUBLIC_PENDING_POLL_MS` (60000) — как часто, пока приложение открыто, обновляется бейдж вкладки «Задачи» (запуски, ждущие подтверждения).

**Push-уведомления (задачи по расписанию).** Приложение берёт нативный FCM-токен устройства и регистрирует его на бэкенде (`POST /api/v1/notifications/devices`); бэкенд шлёт пуши через FCM HTTP v1 напрямую, без сервиса Expo. Для этого нужен файл Firebase:
Firebase Console → проект → Add app → Android, пакет `ai.forbusiness.demo` → скачать `google-services.json` и положить в `mobile/google-services.json`, затем пересобрать (`npx expo prebuild --clean && npx expo run:android`). Файл не секретный по документации Firebase, но пока не коммитится (`mobile/.gitignore`). Без него приложение собирается и работает, просто не получает токен (в логе одно предупреждение `[push]`). Разрешение на уведомления спрашивается после входа; статус и переход в настройки — в Профиле.

В приложении появились нативные модули (Google Sign-In, Apple Authentication, expo-linear-gradient, expo-localization), поэтому старая dev-сборка с ними не заработает — пересобери: `npx expo run:android` (если сборка падает на старых нативных файлах — сначала `npx expo prebuild --clean`). Переменные `EXPO_PUBLIC_*` вшиваются при сборке JS: после их изменения перезапусти Metro с `npx expo start -c`.

### 4. Telegram

Бот не нужен: в приложении Connectors → Connect Telegram → номер телефона → код из Telegram → пароль 2FA (если включён).

### 5. Bitrix24

Ключи в `.env` не нужны. В Битрикс24: Разработчикам → Другое → Входящий вебхук, отметить права CRM (и при желании Задачи, Пользователи), скопировать адрес вида `https://портал.bitrix24.ru/rest/1/xxxx/`. В приложении: Connectors → Bitrix24 → вставить адрес → Connect.

На Windows сборка Android может упасть с `ninja: error: mkdir(...)` из-за длинных путей. Тогда поставь в Android Studio → SDK Manager → SDK Tools пакет CMake 3.31 или новее и добавь в `mobile/android/local.properties` строку `cmake.dir=C\:/Users/<you>/AppData/Local/Android/Sdk/cmake/<версия>`.

После изменений в чате (папка `webview/`) обнови его в приложении:

```bash
cd webview && npm install && npm run sync
```
