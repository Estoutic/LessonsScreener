# Screener — Chrome Extension MVP

Автоматический захват страниц PDF-документа на kiber-one.pro с сохранением PNG локально.

## Быстрый старт

### 1. Установка зависимостей

```bash
cd extension
npm install
```

### 2. Сборка

```bash
npm run build
```

Результат сборки → `extension/dist/`.

Для автопересборки при изменениях:

```bash
npm run watch
```

### 3. Загрузка в Chrome

1. Открыть `chrome://extensions/`
2. Включить **Developer mode** (переключатель справа вверху)
3. Нажать **Load unpacked**
4. Выбрать папку `extension/dist/`
5. Расширение появится в панели расширений

### 4. Использование

1. Открыть `https://kiber-one.pro` в браузере
2. Залогиниться вручную
3. Перейти на страницу с документом (PDF preview)
4. Нажать иконку расширения Screener
5. Нажать **Test** — проверить, что один скриншот сохранился в `~/Downloads/screener/`
6. Нажать **Start** — запустить полный цикл
7. Нажать **Stop** для остановки в любой момент

Файлы сохраняются в `~/Downloads/screener/page-001.png`, `page-002.png`, ...

## Тестирование на вашем сценарии

1. Убедитесь, что страница с документом полностью загружена
2. Убедитесь, что видна toolbar с кнопками навигации (стрелки и номер страницы)
3. Нажмите **Test** — должен сохраниться один PNG с текущей страницей
4. Проверьте качество crop: если область некорректная, настройте fallback coordinates в `config.ts`
5. Нажмите **Start** для автоматического прохода всех страниц

## How to adjust selectors and crop area later

Все селекторы и fallback coordinates находятся в одном файле:

**`src/config.ts`**

### Селекторы

```typescript
export const SELECTORS = {
  toolbarContainer: 'div.MuiBox-root.css-5ax1kt',
  pageNumberButton: 'button[data-testid="page-number"]',
  prevButton: 'div.MuiBox-root.css-5ax1kt > button:nth-of-type(1)',
  nextButton: 'div.MuiBox-root.css-5ax1kt > button:nth-of-type(3)',
  pdfPage: 'div.react-pdf__Page[data-page-number]',
  pdfCanvas: '.react-pdf__Page__canvas',
};
```

Если сайт обновит CSS-классы, замените селекторы здесь.

### Fallback Coordinates

```typescript
export const FALLBACK_CROP: DOMRectData = {
  x: 200,
  y: 100,
  width: 595,
  height: 841,
};
```

Если DOM-элемент PDF не найден, расширение использует эти координаты (CSS pixels).
Измерьте нужную область через DevTools (Cmd+Shift+C → наведите на PDF).

### Имена файлов

```typescript
export const DOWNLOAD_CONFIG = {
  filePrefix: 'page',    // → page-001.png
  padDigits: 3,
  subfolder: 'screener', // → ~/Downloads/screener/
};
```

## Known limitations of MVP

1. **Только kiber-one.pro** — селекторы захардкожены под один сайт
2. **CSS-классы MUI могут измениться** — `css-5ax1kt` генерируется MUI и может поменяться при обновлении
3. **Один документ за раз** — нет batch-режима для нескольких документов
4. **Нет retry при ошибках** — если скриншот не удался, цикл останавливается
5. **Нет определения общего числа страниц** — неизвестно заранее, сколько страниц в документе
6. **Service worker может уснуть** — при долгих паузах Chrome может выгрузить service worker (маловероятно при активном цикле)
7. **Fallback coordinates статичны** — если окно браузера другого размера, они не подойдут
8. **Нет поддержки zoom** — если пользователь изменит масштаб PDF, crop area сместится

## Next improvements after MVP

1. **Адаптивные селекторы** — конфигурация через popup UI вместо хардкода
2. **Visual crop tool** — пользователь вручную выделяет область на экране
3. **Retry logic** — автоматический повтор при ошибках
4. **Progress bar** — отображение прогресса (X из Y страниц)
5. **Batch mode** — обработка нескольких документов подряд
6. **Backend upload** — отправка файлов на сервер вместо локального сохранения
7. **Определение общего числа страниц** — парсинг DOM или пробный проход
8. **Профили сайтов** — адаптеры под разные сайты с разными селекторами
9. **Keep-alive для service worker** — предотвращение выгрузки при долгих операциях
