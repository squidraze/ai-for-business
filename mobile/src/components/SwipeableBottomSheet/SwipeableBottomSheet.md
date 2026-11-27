# SwipeableBottomSheet — скролл внутри drawer'а

Гайд о том, **как правильно сделать прокручиваемый список/контент внутри
`SwipeableBottomSheet`**. Если просто положить `ScrollView` в sheet — он
**не будет скроллиться**. Ниже — почему так и как делать правильно.

## TL;DR

```tsx
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSheetScrollView } from '@/components/SwipeableBottomSheet';

const MyStage = () => {
  // Хук берёт контекст sheet'а и отдаёт готовые props + жест.
  const { onScroll, scrollEventThrottle, gesture, bounces } = useSheetScrollView();

  const list = (
    <Animated.ScrollView
      onScroll={onScroll}
      scrollEventThrottle={scrollEventThrottle}
      bounces={bounces}
      showsVerticalScrollIndicator={false}
    >
      {/* ...контент... */}
    </Animated.ScrollView>
  );

  // gesture === null, только если компонент рендерится ВНЕ sheet'а.
  return gesture ? <GestureDetector gesture={gesture}>{list}</GestureDetector> : list;
};
```

Три обязательных шага:

1. Скроллер — это **`Animated.ScrollView` / `Animated.FlatList`** (из
   `react-native-reanimated`), **не** обычный `ScrollView` из `react-native`.
2. На скроллер навешиваются `onScroll`, `scrollEventThrottle` **и `bounces`** из
   хука.
3. Скроллер оборачивается в `<GestureDetector gesture={gesture}>`.

…и **четвёртый, без которого скролла не будет вообще** — см. следующий раздел:
скроллеру нужна **конкретная высота**.

## Скроллеру нужна конкретная высота (иначе он не скроллится)

Три шага выше решают только **конфликт жестов**. Они не дают скроллеру высоту —
а без неё скроллить нечего.

Sheet по умолчанию **сайзится по контенту**: его высота = высота того, что внутри.
Значит внутри нет «доступного места», от которого можно оттолкнуться:

- `flex: 1` на скроллере не за что цепляться — родитель сам auto-высоты, поэтому
  скроллер просто **растёт вместе с контентом**;
- `maxHeight: height * 0.8` тоже не спасает: sheet вырастает до этого предела, а
  контент внутри ScrollView ровно такой же высоты — **ничего не обрезается,
  значит нечего прокручивать**.

Симптом ровно такой: контент виден целиком до низа экрана, дальше палец ничего не
двигает.

**Правильно — задать телу drawer'а высоту в пикселях и пустить `flex: 1` вниз:**

```tsx
const SHEET_HEIGHT_RATIO = 0.6;

const Body = () => {
  const { height } = useWindowDimensions();
  const { onScroll, scrollEventThrottle, gesture, bounces } = useSheetScrollView();

  const scroller = (
    <Animated.ScrollView
      style={{ flex: 1 }} // ← бьётся о конкретную высоту родителя ниже
      onScroll={onScroll}
      scrollEventThrottle={scrollEventThrottle}
      bounces={bounces}
    >
      {/* ...контент... */}
    </Animated.ScrollView>
  );

  const list = gesture ? <GestureDetector gesture={gesture}>{scroller}</GestureDetector> : scroller;

  // Конкретная высота — именно она включает скролл.
  return <View style={{ height: Math.round(height * SHEET_HEIGHT_RATIO) }}>{list}</View>;
};
```

`GestureDetector` при этом оборачивает **сам скроллер**, а не внешний `View` —
нативный жест должен привязаться к ScrollView.

Ровно этот приём — в drawer'е сервисов рейса: тело фиксировано
(`sheetBody: { height: 420 }` в
[ShipmentServices/styles.ts](../../features/shipments/components/ShipmentServices/styles.ts)),
и уже от него `flex: 1` доходит до списка
([documents/styles.ts](../../features/shipments/components/ShipmentServices/documents/styles.ts)).

Альтернатива — `fullHeight` (см. ниже): там высоту sheet'у задаёт сам компонент,
и `flex: 1` работает. Но `fullHeight` — это **всегда почти весь экран**; если
drawer должен занимать часть экрана, фиксируй высоту тела сам.

Реальный баг: `BalanceDetailSheet` (wallet → earnings) после добавления графика
рассрочки не скроллился — все три шага из TL;DR были соблюдены, но скроллер стоял
с `maxHeight` внутри content-sized sheet'а. Тело переведено на фиксированную
высоту (60% экрана) + `flex: 1`.

Учти: этого одного было **недостаточно** — там же вскрылась вторая, независимая
причина (связь жестов через ref, см. раздел про `withRef` ниже). Если геометрия
уже правильная, а скролл всё равно мёртвый — проверяй жесты, а не размеры.

## Почему обычный `ScrollView` не скроллится

Sheet ловит каждый вертикальный drag своим `Gesture.Pan()`, чтобы реализовать
swipe-to-close. По умолчанию этот pan **выигрывает** у нативного скролла, поэтому
любой `ScrollView` внутри sheet'а оказывается «замороженным» — палец тянет sheet,
а не список.

`useSheetScrollView()` решает это так:

- Создаёт **`Gesture.Native()`** (нативный жест скролла самого `ScrollView`) и
  объявляет его `simultaneousWithExternalGesture(panGesture)` — теперь скролл и
  pan работают **одновременно**, pan больше не блокирует прокрутку.
  Связь объявляется **объектом жеста**, не ref'ом — почему, см. ниже.
- Через `onScroll` прокидывает текущий `contentOffset.y` обратно в sheet
  (`scrollOffset`). Sheet тянется вниз и закрывается **только когда список в самом
  верху** (`scrollOffset <= 0`). В середине списка вертикальный drag уходит в
  прокрутку, а не в закрытие.
- Отдаёт **`bounces: false`**. Скролл и pan работают одновременно, поэтому на iOS
  drag вниз у верха списка иначе одновременно **и** «пружинит» контент
  (overscroll уводит offset в минус), **и** тянет sheet вниз — визуально список и
  sheet едут вместе. С `bounces={false}` offset у верха жёстко держится на 0:
  двигается только sheet, а не контент.

Плюс сам sheet при этом фиксирует «базовую» точку drag'а в момент, когда список
дошёл до верха: если свайп начался с прокрутки в середине списка и достиг верха на
полпути, sheet поедет **с нуля**, а не прыгнет сразу на всю накопленную дистанцию
(иначе он захлопывался бы мгновенно, как только список касается верха).

## Почему связь с pan'ом — объект жеста, а не ref (`withRef`)

RNGH резолвит `simultaneousWithExternalGesture(x)` в handler tag так
(`GestureDetector/utils.ts` → `convertToHandlerTag`): если `x` — это `BaseGesture`,
берётся `x.handlerTag`; если ref — `x.current?.handlerTag ?? -1`.

Ref-вариант здесь **не работает**. Конфиг жеста уезжает в UI-runtime и
конвертируется в serializable, поэтому более поздняя запись RNGH
`config.ref.current = this` (`gesture.ts` → `initialize()`) **отбрасывается** — в
Metro это видно как:

```
[Worklets] Tried to modify key `current` of an object which has been already
passed to a worklet.
```

Дальше по цепочке: tag резолвится в `-1` → `extractValidHandlerTags` его
отфильтровывает → в нативный конфиг уходит пустой `simultaneousHandlers` →
`canRunSimultaneously(scroll, pan) === false`
(`GestureHandlerOrchestrator.kt`) → **как только pan активируется, он отменяет
нативный скролл**.

Симптом коварный: список выглядит корректно и жест до него **доходит**
(`onScrollBeginDrag` срабатывает на каждый свайп), но контент не двигается ни на
пиксель.

Поэтому sheet:

- отдаёт детям **сам `panGesture`** через контекст (`withRef` убран);
- **мемоизирует** его, а `onClose` прокидывает через ref — иначе inline-стрелка
  `onClose={() => setX(null)}` у родителя пересоздавала бы жест на каждый рендер,
  и дети держали бы ссылку на устаревший объект с чужим tag'ом.

## Правила (что важно не нарушать)

- **Только `Animated.*` компоненты.** `onScroll` из хука — это
  `useAnimatedScrollHandler` и работает на UI-потоке; обычный `ScrollView` его не
  примет корректно. Используй `Animated.ScrollView` или `Animated.FlatList`.
- **Не теряй `scrollEventThrottle`.** Без него (на iOS) offset обновляется редко,
  и sheet будет закрываться/дёргаться в неожиданные моменты. Хук уже отдаёт
  значение `16` — просто прокинь его.
- **Оборачивай в `GestureDetector`.** Без обёртки нативный жест не привяжется к
  скроллеру, и прокрутка снова достанется pan'у.
- **Проверяй `gesture` на `null`.** Хук возвращает `gesture === null`, если
  компонент отрендерен вне `SwipeableBottomSheet` (нет контекста). Рендери список
  напрямую в этом случае — паттерн `gesture ? <GestureDetector …> : list`.
- **Один скроллер на экран sheet'а.** Не вкладывай прокручиваемую область в другую
  прокручиваемую область — offset'ы будут конфликтовать. На каждую «стадию» drawer'а
  — свой `useSheetScrollView()`.
- **Не оборачивай навигатор/контент в `className="dark"`** и не вкладывай sheet в
  sheet — это к скроллу не относится, но ломает css-interop (см. заметки проекта).

## Обычный `ScrollView` ломает и свайп-закрытие (iOS)

Тот же самый обычный `ScrollView` внутри sheet'а ломает не только прокрутку, но и
**закрытие свайпом на iOS**. Симптом: тянешь sheet вниз пальцем по контенту — и он
**не закрывается**, свайп «съедается» контентом.

Причина та же, что и с прокруткой, но с другой стороны: нативный скролл обычного
`ScrollView` перехватывает вертикальный drag и **не отдаёт** его `Gesture.Pan()`
sheet'а. Pan и скролл не объявлены одновременными (`simultaneousWithExternalGesture`),
поэтому на iOS выигрывает скролл — палец «двигает список» (даже если двигать некуда),
а не тянет sheet. В итоге swipe-to-close не срабатывает.

Лечится **тем же** паттерном `useSheetScrollView()` (см. TL;DR выше): переводишь
скроллер на `Animated.ScrollView`, навешиваешь `onScroll` / `scrollEventThrottle` /
`bounces` и оборачиваешь в `<GestureDetector gesture={gesture}>`. После этого:

- скролл и pan работают **одновременно** — список скроллится, где есть что скроллить;
- когда список **в самом верху** (`scrollOffset <= 0`), вертикальный drag уходит в
  sheet и он закрывается свайпом.

**Вывод: никогда не клади «голый» `<ScrollView>`/`<FlatList>` из `react-native` в
sheet.** Даже если контент помещается и «скроллить нечего» — на iOS он всё равно
перехватит свайп и sheet перестанет закрываться жестом. Всегда используй
`useSheetScrollView()`.

Реальный баг из-за этого: `BalanceDetailSheet` (wallet → earnings) — внутри был
обычный `ScrollView`, drawer не закрывался свайпом на iOS. Исправлено переводом на
`useSheetScrollView()` — см.
[BalanceDetailSheet.tsx](../../features/wallet/components/earnings/BalanceDetailSheet.tsx).

## Полноэкранный sheet (`fullHeight`)

Для длинного контента открывай sheet во весь экран — тогда у списка есть фиксированная
высота, и прокрутка ведёт себя предсказуемо:

```tsx
<SwipeableBottomSheet isOpen={isOpen} onClose={onClose} fullHeight>
  {({ close }) => <MyStage close={close} />}
</SwipeableBottomSheet>
```

При `fullHeight` sheet держит постоянную высоту (`SCREEN_HEIGHT - topInset`) и не
прыгает под клавиатурой — клавиатура поджимает контент снизу через `paddingBottom`.
Это нужно, когда внутри есть и скролл-список, и поля ввода.

## Рабочие примеры в коде

- [documents/components/DocTypeStage.tsx](../../features/shipments/components/ShipmentServices/documents/components/DocTypeStage.tsx)
  — список типов документов.
- [documents/components/FileListStage.tsx](../../features/shipments/components/ShipmentServices/documents/components/FileListStage.tsx)
- [services/feedback/components/CreateFeedbackSheet.tsx](../../features/services/feedback/components/CreateFeedbackSheet.tsx)
  — скролл + поля ввода в `fullHeight`-sheet.

## Частые ошибки

| Симптом                                                            | Причина                                                                                                               | Что делать                                                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Список вообще не скроллится                                        | Обычный `ScrollView` / нет `GestureDetector`                                                                          | Перейти на `Animated.ScrollView` и обернуть в `GestureDetector gesture={gesture}`             |
| Всё по TL;DR, но список всё равно не скроллится                    | У скроллера нет конкретной высоты (`maxHeight`/`flex: 1` в content-sized sheet'е)                                     | Задать телу drawer'а `height` в пикселях, скроллеру — `flex: 1`                               |
| Высота есть, `onScrollBeginDrag` срабатывает, контент не двигается | Связь с pan'ом резолвится в tag `-1`, pan отменяет нативный скролл (warning `[Worklets] Tried to modify key current`) | Связь по **объекту** `panGesture`, а не по ref'у, и жест мемоизирован — уже сделано в sheet'е |
| iOS: sheet не закрывается свайпом по контенту                      | Обычный `ScrollView` перехватывает pan                                                                                | Перейти на `useSheetScrollView()` — тот же паттерн, что и для скролла                         |
| Sheet закрывается при скролле в середине списка                    | Не прокинут `onScroll`/`scrollEventThrottle`                                                                          | Навесить оба props из хука на скроллер                                                        |
| iOS: контент «пружинит»/едет вместе с закрытием                    | Не прокинут `bounces` из хука                                                                                         | Навесить `bounces={bounces}` на скроллер                                                      |
| `gesture` всегда `null`                                            | Компонент рендерится вне `SwipeableBottomSheet`                                                                       | Проверить, что список находится внутри sheet'а (в его `children`)                             |
| Скролл «дёргается» под клавиатурой                                 | Контент-sized sheet + длинный список с инпутами                                                                       | Открыть sheet с `fullHeight`                                                                  |
