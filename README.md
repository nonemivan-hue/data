# data_card — ACR1281U · чтение всех данных карты (Python, Windows)

Программа считывает карту на ридере **ACS ACR1281U** (PC/SC, CCID, 13.56 МГц)
и сохраняет результат в файл **«параметр : значение»** (`.txt`) и его
JSON-копию.

Репозиторий: `https://github.com/nonemivan-hue/data_card.git`

## Версии

- **v1.1** — исправлен сбой `0x0000001F «устройство не работает»`:
  аппаратные ошибки обмена теперь перехватываются и попадают в секцию
  «Ошибки» отчёта (скрипт не падает, файл создаётся всегда); добавлен
  автоперебор интерфейсов **PICC → ICC** (для контактных карт), чтение
  страниц NTAG/Ultralight, ATS для ISO 14443-4, параметры «Интерфейс»
  и «Python» в отчёте.
- v1.0 — первый выпуск.

## Что читает скрипт `acr1281_dump.py`

| Данные | Как получаются |
|---|---|
| Ридер, протокол T=0/T=1, **ATR** | PC/SC `connect` / `getATR` |
| **UID**, длина UID | `FF CA 00 00 00` |
| **ATQA (SENS_RES)**, **SAK (SEL_RES)**, тип карты | Polling `FF 00 00 00 04 D4 4A 01 00` |
| Режим/скорость PICC | `FF 00 00 00 04 D4 32 01 00` |
| Все сектора Mifare Classic 1K/4K/Mini | `FF 82` (ключ) + `FF 86` (auth) + `FF B0` (чтение) заводскими ключами |
| Страницы NTAG / Ultralight | `FF B0 00 <стр> 10` — без аутентификации (v1.1) |
| ATS (для ISO 14443-4) | `FF CA 01 00 00` |
| Приложения EMV (контактные карты) | PPSE `1PAY.SYS.DDF01` + READ RECORD |

## Файлы

```
acr1281_dump.py    основной скрипт
requirements.txt   зависимости (pyscard)
run.bat            запуск двойным кликом
card_report_*.txt  результат — «параметр : значение» (создаётся при запуске)
card_report_*.json результат в JSON (создаётся при запуске)
src/  index.html   сайт-справка: код, разбор ATR, образцы отчёта, установка
```

## Установка (Windows)

1. Драйвер: **Device Manager → Update driver** для `ACS CCID USB Reader`
   (или ACS CCID driver с acs.com.hk). Убедитесь, что служба **«Смарт-карта»**
   (`scardsvr`) запущена.
2. Python 3.10–3.13: `python --version`
3. Зависимости:

   ```powershell
   pip install -r requirements.txt
   ```

4. Запуск:

   ```powershell
   python acr1281_dump.py
   ```

В папке появятся `card_report_<UID>_<ГГГГММДД_ЧЧММСС>.txt` и `.json`.

## Если что-то пошло не так

| Симптом | Причина и решение |
|---|---|
| `0x0000001F «устройство не работает»` | Карте послана неподдерживаемая команда (например, `00 A4 …` в NTAG через PICC). В v1.1 такие сбои пишутся в секцию «Ошибки» отчёта, скрипт не падает. Контактные EMV-карты вставляйте в ICC-слот — скрипт сам переберёт интерфейсы. |
| `ModuleNotFoundError: smartcard` | `pip install pyscard` для того же Python, которым запускаете (проверено на 3.10–3.14). |
| «Ридеры не найдены» | Запустите службу «Смарт-карта» (`net start SCardSvr`) и поставьте драйвер ACS CCID. |
| «ключ не подошёл» у части секторов | Ключи не заводские — добавьте свои в `FACTORY_KEYS` в начале скрипта. |

## Публикация в GitHub

Один раз, из папки проекта:

```powershell
git init
git branch -M main
git remote add origin https://github.com/nonemivan-hue/data_card.git
git add .
git commit -m "ACR1281U: чтение данных карты и сохранение отчёта (txt+json)"
git push -u origin main
```

Если репозиторий на GitHub уже содержит файлы (README и т.п.), сначала:

```powershell
git pull origin main --allow-unrelated-histories
git push -u origin main
```

Дальше достаточно `git add . && git commit -m "..." && git push`.

> Отчёты чтения (`card_report_*`) уже добавлены в `.gitignore` — данные карт
> в репозиторий не попадут.

## Сайт-справка (опционально)

В репозитории лежит интерактивная справка (Vite + React): запуск локально —
`npm install && npm run dev`, сборка — `npm run build` (результат в `dist/`).
Для GitHub Pages удобно публиковать `dist/` через Actions (workflow
«Deploy static content to Pages», папка `dist`, ветка `main`).

## Важно

Инструмент для диагностики **собственных** карт и карт, на чтение которых есть
разрешение. Чтение чужих карт может нарушать закон (ст. 272 УК РФ и аналоги).
