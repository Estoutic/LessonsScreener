# Screener — Chrome Extension MVP

## Цель
Chrome Extension (Manifest V3, TypeScript) для сайта kiber-one.pro.
После ручного логина расширение автоматически перелистывает страницы PDF-вьюера, делает скриншот каждой страницы, кропает до области PDF и сохраняет как PNG в `~/Downloads/screener/`.

## Целевой сайт
- URL: `https://kiber-one.pro/*`
- PDF-вьюер построен на React 18 + react-pdf + MUI
- Кнопки навигации — React-компоненты с `data-testid="page-number"`
- PDF рендерится в `div.react-pdf__Page[data-page-number]` с canvas внутри

## Архитектура

```
popup.html / popup.ts          — UI с кнопками Start/Stop/Test, статус, логи
        ↕ chrome.runtime messages
service-worker.ts              — оркестрация: capture loop, state, main-world клики
        ↕ chrome.tabs messages          ↕ chrome.scripting.executeScript(world:'MAIN')
content-script.ts              — чтение DOM (rect, page number)
        ↓
dom-adapter.ts                 — DOM-взаимодействие (чтение координат, селекторы)

offscreen.html / offscreen.ts  — Canvas-кроп (MV3 service worker не имеет Canvas API)
        ↓
crop.ts                        — чистая функция кропа изображения
```

## Файловая структура

```
extension/
├── manifest.json              — MV3 manifest
├── package.json               — npm: esbuild + chrome-types
├── tsconfig.json              — TypeScript config
├── build.mjs                  — esbuild сборка (4 entry points → dist/)
├── popup.html                 — popup UI
├── offscreen.html             — offscreen document для кропа
├── assets/
│   └── icon128.png            — иконка расширения
├── src/
│   ├── config.ts              — ВСЕ селекторы, координаты, тайминги, debug-флаги
│   ├── types.ts               — TypeScript интерфейсы (PageInfo, DOMRectData, все Message типы)
│   ├── service-worker.ts      — главный оркестратор (capture loop, main-world клики)
│   ├── content-script.ts      — message listener, делегирует в dom-adapter
│   ├── dom-adapter.ts         — чтение DOM: rect, page number, кнопки, React fiber
│   ├── capture.ts             — chrome.tabs.captureVisibleTab wrapper
│   ├── crop.ts                — Canvas-кроп с DPR-масштабированием
│   ├── offscreen.ts           — listener для crop-сообщений
│   ├── downloads.ts           — сохранение PNG через chrome.downloads
│   ├── popup.ts               — popup UI логика и рендер состояния
│   ├── logger.ts              — логгер с буфером (50 записей)
│   ├── state.ts               — ProcessState управление
│   └── messages.ts            — helpers для отправки сообщений
└── dist/                      — собранные файлы (загружаются в Chrome)
```

## Сборка и запуск

```bash
cd extension
npm install
npm run build          # node build.mjs → dist/
npm run watch          # watch mode
```

Загрузить в Chrome: `chrome://extensions` → Developer mode → Load unpacked → выбрать `extension/dist/`

## Ключевые DOM-селекторы (config.ts)

```typescript
SELECTORS = {
  pageNumberButton: 'button[data-testid="page-number"]',          // кнопка с номером страницы
  nextButton: 'button[data-testid="page-number"] + button',       // Next = сосед после page-number
  toolbarContainer: 'div.MuiBox-root.css-5ax1kt',                 // toolbar (fallback, MUI-класс может меняться)
  prevButton: 'div.MuiBox-root.css-5ax1kt > button:nth-of-type(1)', // Prev (fallback)
  pdfPage: 'div.react-pdf__Page[data-page-number]',               // PDF страница
  pdfCanvas: '.react-pdf__Page__canvas',                           // PDF canvas
}

FALLBACK_CROP = { x: 470, y: 25, width: 545, height: 790 }  // CSS px, MacBook
TIMING = { pageChangeTimeout: 8000, pageChangePoll: 200, postChangeDelay: 500, interCycleDelay: 300 }
DEBUG = { saveFullScreenshot: true, verbose: true }
```

## Capture Loop (service-worker.ts)

1. Inject content script
2. Navigate to first page (main world: кликает Prev пока не disabled)
3. Цикл:
   a. `get-page-info` через content script (isolated world) — читает rect, page number, DPR
   b. `captureVisibleTab` — полный скриншот вкладки
   c. Crop через offscreen document (Canvas API)
   d. Save PNG через `chrome.downloads`
   e. Click Next в **main world** через `chrome.scripting.executeScript({ world: 'MAIN' })`
   f. Poll для смены страницы (читаем номер через content script)
   g. Repeat

## КРИТИЧЕСКАЯ ПРОБЛЕМА: Isolated World vs Main World

**Проблема**: Content script работает в Chrome's isolated world. React 18 делегирует события на корневой контейнер в main world. Клики из isolated world (через `.click()`, `dispatchEvent`, даже прямой вызов React fiber `onClick`) НЕ вызывают корректную обработку React'ом — счётчик страницы может измениться, но PDF не перерендеривается.

**Попробованные подходы (ВСЕ НЕУДАЧНЫЕ из isolated world)**:
1. `element.click()` — не работает
2. `dispatchEvent(new MouseEvent('click'))` — не работает
3. `dispatchEvent(pointerdown → mousedown → pointerup → mouseup → click)` — не работает
4. React fiber `memoizedProps.onClick(syntheticEvent)` — счётчик меняется, PDF не рендерится
5. Удаление `disabled` атрибута + dispatch — не работает

**Решение (РЕАЛИЗОВАНО, НО НЕ ПРОТЕСТИРОВАНО)**:
Все операции клика перенесены в `service-worker.ts` и выполняются через:
```typescript
chrome.scripting.executeScript({
  target: { tabId },
  world: 'MAIN',    // ← ключевое: выполняется в контексте страницы
  func: (selectors) => {
    const btn = document.querySelector(selectors.nextButton);
    btn.click();     // теперь .click() в main world — React обработает
  },
  args: [{ ... }],
});
```

Три новые функции:
- `clickNextInMainWorld(tabId)` — клик Next в main world
- `goToFirstInMainWorld(tabId)` — навигация к первой странице через Prev в main world
- `isNextDisabledMainWorld(tabId)` — проверка disabled в main world

Content script по-прежнему читает DOM (rect, page number) — это работает из isolated world.

## Решённые проблемы

1. **Двойная инжекция content script**: manifest + executeScript → guard `window.__screener_loaded`
2. **Invalid `chrome.offscreen.Reason.CANVAS`**: заменено на `Reason.BLOBS`
3. **Неверный кроп (нижняя часть)**: `getBoundingClientRect()` возвращал полный rect элемента за пределами viewport → viewport clamping в `getPageRect()`
4. **"Reached last page" на первом скриншоте**: MUI CSS-класс изменился → переход на `data-testid` селекторы + multi-strategy поиск кнопок
5. **Страницы не переключаются**: isolated world problem → main world solution (см. выше)

## Текущий статус

- Скриншоты делаются корректно (кроп по границам PDF)
- Сохранение PNG работает
- Popup UI работает
- **Переключение страниц — реализовано через main world, но НЕ ПРОТЕСТИРОВАНО пользователем**
- Debug: `saveFullScreenshot: true` — сохраняет и полные скриншоты для отладки

## Следующие шаги

1. Протестировать переключение страниц с main world подходом
2. Если работает — выключить `saveFullScreenshot` в config.ts
3. Тонкая настройка таймингов если нужно
4. Адаптация для других сайтов (абстракция селекторов по сайтам)

## Permissions (manifest.json)

- `activeTab` — доступ к активной вкладке
- `scripting` — для `executeScript` с `world: 'MAIN'`
- `downloads` — сохранение файлов
- `offscreen` — offscreen document для Canvas кропа
- `storage` — (зарезервировано)
- Host: `https://kiber-one.pro/*`

## Технологии

- TypeScript
- esbuild (bundler)
- Chrome Extension Manifest V3
- `chrome.tabs.captureVisibleTab` → PNG data URL
- Canvas API (offscreen document) для кропа
- `chrome.scripting.executeScript({ world: 'MAIN' })` для React-совместимых кликов
- `chrome.downloads.download` для сохранения
