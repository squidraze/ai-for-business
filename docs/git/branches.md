# Ветки и окружения

Для кого: все, кто пишет код в forBusiness, включая ИИ-ассистентов.

## Коротко

- `main` — основная ветка разработки. Всегда собирается и запускается.
- `prod` — то, что работает у пользователей. Меняется только через PR.
- Вся работа идёт в коротких ветках `<тип>/<описание>` от `main`.
- Срочное исправление продакшена — ветка `hotfix/...` от `prod`.

## Постоянные ветки

| Ветка | Зачем | Окружение | Как меняется |
|---|---|---|---|
| `main` | интеграция всей работы, ветка по умолчанию | staging | слияние рабочих веток |
| `prod` | продакшен | production | только PR из `main` (релиз) или из `hotfix/*` |

Обе ветки защищены на GitHub: их нельзя удалить и нельзя переписать историю
(`force push`). В `prod` нельзя пушить напрямую, только через PR.

## Рабочие ветки

Формат: `<тип>/<короткое-описание>`.

- Латиница, нижний регистр, слова через дефис, до ~50 символов.
- Тип совпадает с типом коммитов ([commits.md](commits.md)).
- Если работа касается одной интеграции или части, назовите её в описании.

| Тип | Когда | Пример |
|---|---|---|
| `feat/` | новая возможность | `feat/instagram-direct` |
| `fix/` | исправление ошибки | `fix/mobile-bitrix-keyboard` |
| `refactor/` | переделка без изменения поведения | `refactor/telegram-integration-module` |
| `perf/` | ускорение | `perf/gmail-thread-list` |
| `docs/` | только документация | `docs/git-rules` |
| `test/` | только тесты | `test/runner-confirmations` |
| `build/` | сборка, зависимости | `build/expo-sdk-59` |
| `ci/` | GitHub Actions, деплой | `ci/backend-staging-deploy` |
| `chore/` | прочая рутина | `chore/cleanup-env-example` |
| `hotfix/` | срочный фикс продакшена, от `prod` | `hotfix/telegram-login-crash` |

Правила:

- Ветка живёт недолго: в пределах спринта (10 дней), лучше 1–3 дня.
  Большую задачу режем на несколько веток, которые можно вливать по очереди.
- Одна ветка — одна задача. Не смешиваем фичу и несвязанный рефакторинг.
- Перед слиянием подтягиваем свежий `main` (`git merge main` или `git rebase main`
  для ветки, которую ещё никто не забрал).
- После слияния ветку удаляем (на GitHub это происходит автоматически).

## Обычный цикл

```bash
git switch main && git pull
git switch -c feat/instagram-direct
# ... коммиты по правилам commits.md ...
git push -u origin feat/instagram-direct
```

Дальше одно из двух:

- **PR в `main`** на GitHub (предпочтительно, особенно когда в команде больше
  одного разработчика). Способ слияния — merge commit.
- **Локальное слияние** (пока код пишет один человек):

  ```bash
  git switch main && git pull
  git merge --no-ff feat/instagram-direct
  git push origin main
  git branch -d feat/instagram-direct && git push origin --delete feat/instagram-direct
  ```

Мы сохраняем merge commit (`--no-ff`), чтобы в истории было видно, какие коммиты
пришли одной задачей.

## Релиз в продакшен

Релиз — в конце спринта или когда `main` проверен на staging.

1. Убедиться, что `main` собирается и проверен на staging.
2. Открыть PR `main` → `prod` с названием `release: vX.Y.Z` и списком изменений.
3. Влить PR (merge commit).
4. Поставить тег на `prod` и запушить его:

   ```bash
   git switch prod && git pull
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

5. Создать GitHub Release из тега (`gh release create v0.2.0 --generate-notes`).

### Версии

[SemVer](https://semver.org/lang/ru/): `vMAJOR.MINOR.PATCH`.

- `PATCH` — только исправления (`fix`), в том числе hotfix.
- `MINOR` — новые возможности (`feat`) без поломки старого.
- `MAJOR` — ломающие изменения (`!` / `BREAKING CHANGE` в коммитах).
  До выхода в сторы живём в `0.x.y`.

Версия мобилки для сторов (`version`, `versionCode`/`buildNumber` в конфиге
Expo) меняется в том же релизном PR.

## Hotfix

Когда в продакшене ошибка, которая не может ждать релиза:

```bash
git switch prod && git pull
git switch -c hotfix/telegram-login-crash
# фикс + коммит fix(...)
git push -u origin hotfix/telegram-login-crash
```

1. PR `hotfix/...` → `prod`, влить, поставить тег с увеличенным `PATCH`.
2. Сразу влить `prod` обратно в `main` (`git switch main && git merge --no-ff prod`),
   чтобы фикс не потерялся в следующем релизе.

## Окружения

| Окружение | Ветка | Бэкенд | Мобилка | Секреты |
|---|---|---|---|---|
| local | любая | `docker compose up`, `.env` | Expo dev / dev build | локальный `.env`, не коммитится |
| staging | `main` | staging-сервер | EAS channel `preview`, внутреннее тестирование в сторах | GitHub Environment `staging` |
| production | `prod` | прод-сервер (в Узбекистане, см. риски в `for-promt.md`) | EAS channel `production`, сторы | GitHub Environment `production` |

В GitHub уже созданы окружения `staging` (деплой только из `main`) и
`production` (деплой только из `prod` и тегов `v*`). Серверов и CI пока нет:
когда появятся, деплой-воркфлоу берут секреты из этих окружений.

Правила:

- Секреты никогда не коммитим. В репозитории только `.env.example`.
- Ключи staging и production разные (OAuth-клиенты, ключи ИИ, база).
- Миграции базы сначала проходят на staging.

## Защита веток на GitHub (настроено)

- `main`: запрещены удаление и `force push`.
- `prod`: запрещены удаление и `force push`, изменения только через PR.
- Разрешён только merge commit, ветки после слияния удаляются автоматически.

Когда в команде появится второй разработчик, включаем для `main` обязательный
PR с одобрением и проверками CI.
