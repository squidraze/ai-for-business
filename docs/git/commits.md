# Правила коммитов

Для кого: все, кто пишет код в forBusiness, включая ИИ-ассистентов.

Используем [Conventional Commits](https://www.conventionalcommits.org/ru/v1.0.0/).
Сообщения пишем на английском. Формат проверяет хук `.githooks/commit-msg`
(как включить — в конце).

## Формат

```
<type>(<scope>): <summary>

<body — зачем и что изменилось, по желанию>

<footer — BREAKING CHANGE, ссылки на задачи, соавторы>
```

Пример:

```
feat(instagram): list Direct conversations

Uses the Instagram Graph API conversations endpoint. Only professional
accounts are supported; personal accounts get a clear error.

Refs: #12
```

## Тип (`type`)

| Тип | Когда |
|---|---|
| `feat` | новая возможность для пользователя |
| `fix` | исправление ошибки |
| `refactor` | переделка кода без изменения поведения |
| `perf` | ускорение |
| `docs` | только документация |
| `test` | только тесты |
| `style` | форматирование, без изменения логики |
| `build` | сборка, зависимости, Docker, Expo/EAS конфиг |
| `ci` | GitHub Actions и деплой |
| `chore` | прочая рутина |
| `revert` | откат предыдущего коммита |

## Область (`scope`)

Необязательна, но желательна. Одно слово из списка:

- часть системы: `backend`, `mobile`, `webview`, `centrifugo`, `infra`, `docs`;
- интеграция, если изменение относится только к ней: `telegram`, `gmail`,
  `instagram`, `bitrix24`, `amocrm`, `billz`, `moysklad`…;
- общая функция: `ai`, `auth`, `chat`, `billing`, `i18n`, `theme`.

Если изменение затрагивает одну интеграцию и в бэкенде, и в мобилке, область —
название интеграции: `feat(instagram): ...`.

## Заголовок (`summary`)

- Повелительное наклонение: `add`, `fix`, `remove`, а не `added` или `fixes`.
- С маленькой буквы, без точки в конце.
- Вся первая строка — не длиннее 72 символов.
- Описывает результат, а не процесс: `fix(mobile): keep webhook field above the keyboard`,
  а не `fix(mobile): try another approach`.

## Тело и подвал

- Тело — зачем сделано изменение и что важно знать ревьюеру. Пустая строка
  после заголовка, строки до ~72 символов.
- Ломающее изменение (API, схема базы, протокол моста webview): `!` после
  типа/области и подвал `BREAKING CHANGE: <что сломалось и как мигрировать>`.

  ```
  feat(backend)!: move connectors under /integrations

  BREAKING CHANGE: mobile must call /integrations/<name>/... instead of /connectors/<name>/...
  ```

- Коммиты, сделанные с ИИ-ассистентом, заканчиваются строкой
  `Co-Authored-By: ...`.

## Что входит в один коммит

- Одно логическое изменение. Проект должен собираться после каждого коммита.
- Не смешиваем рефакторинг и новую фичу, форматирование и логику.
- Никаких секретов, `.env`, баз SQLite, сессий Telegram, токенов. Перед коммитом
  смотрим `git status` и `git diff --staged`.
- Сгенерированные файлы коммитим только если без них не собирается (например,
  собранный `index.html` веб-чата для мобилки).

## Merge-коммиты

Сообщение по умолчанию от `git merge` (`Merge branch 'feat/...'`) оставляем как
есть. PR из `main` в `prod` называем `release: vX.Y.Z`.

## Хук проверки

В репозитории лежит `.githooks/commit-msg`. Он проверяет формат заголовка и
не даёт делать обычные коммиты прямо в `main` и `prod` (merge-коммиты можно).
Включается один раз на каждую копию репозитория:

```bash
git config core.hooksPath .githooks
```
