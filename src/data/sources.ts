/* ============================================================
   Все исходники и данные приложения
   ============================================================ */

export const PY_SOURCE = `# -*- coding: utf-8 -*-
"""
acr1281_dump.py — полное чтение параметров карты через ACR1281U (Windows, PC/SC)

Установка:  pip install pyscard
Запуск:     python acr1281_dump.py
Результат:  card_report_<UID>_<дата>.txt   — отчёт «параметр : значение»
            card_report_<UID>_<дата>.json  — те же данные в JSON

Что читает:
  * ATR, протокол T=0/T=1, исторические байты (контактные и бесконтактные)
  * UID, ATQA (SENS_RES), SAK (SEL_RES), тип карты   — Polling D4 4A
  * статус PICC (режим, скорость)                    — D4 32
  * ATS для карт ISO 14443-4                         — FF CA 01 00
  * Mifare Classic 1K/4K/Mini: все сектора заводскими ключами
  * NTAG / Ultralight: первые страницы памяти (без аутентификации)
  * контактные EMV-карты: список приложений из PPSE (1PAY.SYS.DDF01)

История версий:
  v1.1 — аппаратные ошибки обмена (0x1F «устройство не работает» и др.)
         больше не валят скрипт: фиксируются в секции «Ошибки» отчёта;
         автоперебор интерфейсов PICC -> ICC; чтение NTAG/Ultralight;
         в отчёте появляются «Интерфейс», «ATS», «Python».
  v1.0 — первый выпуск.
"""

import json
import sys
from datetime import datetime

from smartcard.System import readers
from smartcard.CardConnection import CardConnection
from smartcard.Exceptions import (CardConnectionException, NoCardException,
                                  SmartcardException)

VERSION = "1.1"

# ------------------------------------------------------------- APDU-команды
GET_UID     = [0xFF, 0xCA, 0x00, 0x00, 0x00]                          # UID карты
GET_ATS     = [0xFF, 0xCA, 0x01, 0x00, 0x00]                          # ATS (14443-4)
PICC_POLL   = [0xFF, 0x00, 0x00, 0x00, 0x04, 0xD4, 0x4A, 0x01, 0x00]  # Polling
PICC_STATUS = [0xFF, 0x00, 0x00, 0x00, 0x04, 0xD4, 0x32, 0x01, 0x00]  # статус PICC
READ_BLOCK  = lambda blk: [0xFF, 0xB0, 0x00, blk, 0x10]               # Read Binary
LOAD_KEY    = lambda key: [0xFF, 0x82, 0x00, 0x00, 0x06] + list(key)  # загрузка ключа
AUTH_KEY_A  = lambda blk: [0xFF, 0x86, 0x00, 0x00, 0x05,
                           0x01, 0x00, blk, 0x60, 0x00]               # Mifare Auth A

FACTORY_KEYS = [
    "FF FF FF FF FF FF", "A0 A1 A2 A3 A4 A5", "D3 F7 D3 F7 D3 F7",
    "00 00 00 00 00 00", "B0 B1 B2 B3 B4 B5", "4D 3A 99 C3 51 DD",
    "1A 98 2C 7E 45 9A", "AA BB CC DD EE FF",
]

SAK_TYPES = {
    0x00: "Mifare Ultralight / NTAG",
    0x08: "Mifare Classic 1K",
    0x09: "Mifare Mini",
    0x18: "Mifare Classic 4K",
    0x20: "ISO 14443-4 (DESFire, Plus, NTAG I2C...)",
    0x28: "SmartMX / JCOP (ISO 14443-4 + Mifare)",
}

ERRORS = []  # ошибки обмена, не прерывающие чтение


def hx(data):
    """Список байтов -> строка 'FF 00 3A'."""
    return " ".join("%02X" % b for b in data) if data else "-"


def transmit(conn, apdu):
    """Отправить APDU. При аппаратной ошибке — ([], 0x6F00), без падения."""
    try:
        data, sw1, sw2 = conn.transmit(list(apdu))
        return data, (sw1 << 8) | sw2
    except SmartcardException as exc:
        ERRORS.append("APDU %s -> %s" % (hx(apdu), exc))
        return [], 0x6F00


def find_readers():
    """Ридеры ACR1281U (PICC первыми, затем ICC), иначе все PC/SC-ридеры."""
    found = readers()
    if not found:
        sys.exit("[!] Ридеры не найдены. Проверьте драйвер ACS CCID "
                 "и службу Windows «Смарт-карта» (scardsvr).")
    prefs = [r for r in found if "1281" in str(r).upper()] or found
    picc = [r for r in prefs if "PICC" in str(r).upper()]
    icc = [r for r in prefs if "ICC" in str(r).upper()]
    rest = [r for r in prefs if r not in picc and r not in icc]
    return picc + icc + rest


def interface_of(name):
    n = str(name).upper()
    if "PICC" in n:
        return "PICC — бесконтактный (RF 13.56 МГц)"
    if "ICC" in n:
        return "ICC — контактный (слот смарт-карты)"
    if "SAM" in n:
        return "SAM-слот"
    return "PC/SC"


def connect_any():
    """Подключиться к первому ридеру, где карта отвечает."""
    last_err = None
    for r in find_readers():
        print("[*] Пробую: %s" % r)
        try:
            conn = r.createConnection()
            conn.connect(CardConnection.T0_protocol | CardConnection.T1_protocol)
            print("    подключено (%s)" % interface_of(r))
            return r, conn
        except NoCardException:
            print("    нет карты")
        except CardConnectionException as exc:
            last_err = exc
            print("    ошибка: %s" % exc)
    sys.exit("[!] Ни на одном интерфейсе карта не ответила. "
             "Положите карту на ридер или вставьте в ICC-слот.%s"
             % ("\\n    Последняя ошибка: %s" % last_err if last_err else ""))


def poll_card(conn, report):
    """Бесконтактная часть: UID, ATQA, SAK, тип, ATS. Возвращает SAK/None."""
    uid, sw = transmit(conn, GET_UID)
    if sw == 0x9000 and uid:
        report["UID"] = hx(uid)
        report["Длина UID"] = "%d байт" % len(uid)

    sak = None
    data, sw = transmit(conn, PICC_POLL)
    # Ответ: D5 4B NbTg 01 SENS_RES(2) SEL_RES(1) NFCIDlen NFCID...
    if sw == 0x9000 and len(data) >= 7 and data[0] == 0xD5 and data[2] > 0:
        sens, sak = data[3:5], data[5]
        nlen = data[6]
        report["ATQA (SENS_RES)"] = hx(sens)
        report["SAK (SEL_RES)"] = "%02X" % sak
        report["Тип карты"] = SAK_TYPES.get(sak, "неизвестен (SAK=%02X)" % sak)
        if nlen:
            report["NFCID"] = hx(data[7:7 + nlen])
    else:
        report["ATQA (SENS_RES)"] = "-"
        report["SAK (SEL_RES)"] = "-"
        report["Тип карты"] = "не ISO 14443 (вероятно, контактная)"

    data, sw = transmit(conn, PICC_STATUS)
    if sw == 0x9000 and len(data) >= 5:
        modes = {0x00: "авто", 0x01: "106 кбит/с", 0x02: "212 кбит/с",
                 0x04: "424 кбит/с", 0x08: "848 кбит/с"}
        report["Режим PICC"] = modes.get(data[2], "%02X" % data[2])

    if sak in (0x20, 0x28):
        ats, sw = transmit(conn, GET_ATS)
        if sw == 0x9000 and ats:
            report["ATS"] = hx(ats)
    return sak


def read_mifare(conn, sak, report):
    """Mifare Classic: чтение всех секторов популярными ключами."""
    if sak == 0x18:
        sectors = 40
    elif sak == 0x09:
        sectors = 5
    else:
        sectors = 16

    blocks = {}
    read_ok = 0
    keys_ok = 0
    total_blocks = 0

    for sec in range(sectors):
        if sectors == 40 and sec >= 32:
            first, count = 128 + (sec - 32) * 16, 16
        else:
            first, count = sec * 4, 4
        total_blocks += count

        opened = False
        for key in FACTORY_KEYS:
            kb = [int(x, 16) for x in key.split()]
            if transmit(conn, LOAD_KEY(kb))[1] != 0x9000:
                continue
            if transmit(conn, AUTH_KEY_A(first))[1] == 0x9000:
                opened = True
                keys_ok += 1
                print("  [+] Сектор %02d  ключ %s" % (sec, key))
                break
        if not opened:
            print("  [-] Сектор %02d  ключ не подошёл" % sec)
            continue

        for i in range(count):
            data, sw = transmit(conn, READ_BLOCK(first + i))
            if sw == 0x9000:
                blocks["Блок %03d" % (first + i)] = hx(data)
                read_ok += 1

    report["Прочитано блоков"] = "%d / %d" % (read_ok, total_blocks)
    report["Секторов с ключом"] = "%d / %d" % (keys_ok, sectors)
    return blocks


def read_ntag(conn, report):
    """NTAG / Ultralight: первые 64 байта (страницы 00-0F), ключи не нужны."""
    pages = {}
    for start in (0x00, 0x04, 0x08, 0x0C):
        data, sw = transmit(conn, READ_BLOCK(start))
        if sw == 0x9000:
            pages["Стр. %02X-%02X" % (start, start + 3)] = hx(data)
    if pages:
        report["Страниц прочитано"] = "%d по 4 (00-0F), 16 байт" % len(pages)
    return pages


def read_emv_apps(conn, report):
    """EMV: каталог PPSE -> список AID приложений."""
    ppse = [0x00, 0xA4, 0x04, 0x00, 0x0E] + list(b"1PAY.SYS.DDF01")
    if transmit(conn, ppse)[1] != 0x9000:
        return
    n = 0
    for rec in range(1, 11):
        data, sw = transmit(conn, [0x00, 0xB2, rec, 0x0C, 0x00])
        if sw != 0x9000:
            break
        i = 0
        while i + 1 < len(data):        # ищем тег AID = 0x4F
            tag, ln = data[i], data[i + 1]
            if tag == 0x4F and i + 2 + ln <= len(data):
                n += 1
                report["Приложение %d (AID)" % n] = hx(data[i + 2:i + 2 + ln])
                break
            i += 2 + ln


def build_txt(report, memory, memory_title):
    """Собрать текстовый отчёт: параметр : значение."""
    w = max(len(k) for k in report) + 2 if report else 20
    out = [
        "=" * 60,
        " CARD REPORT - ACR1281U (python, pyscard, v%s)" % VERSION,
        " Дата: " + datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "=" * 60,
        "",
        "[ ПАРАМЕТРЫ ]",
    ]
    for k, v in report.items():
        out.append("  %-*s : %s" % (w, k, v))
    if memory:
        out += ["", "[ %s ]" % memory_title]
        for k, v in memory.items():
            out.append("  %s : %s" % (k, v))
    if ERRORS:
        out += ["", "[ ОШИБКИ (чтение не прервано) ]"]
        for e in ERRORS:
            out.append("  - " + e)
    out.append("")
    return "\\n".join(out)


def main():
    print("=" * 60)
    print("  ACR1281U · ПОЛНОЕ ЧТЕНИЕ ПАРАМЕТРОВ КАРТЫ  (v%s)" % VERSION)
    print("=" * 60)

    reader, conn = connect_any()

    try:
        proto = {0: "direct", 1: "T=0", 2: "T=1", 3: "T=0+T=1"}.get(
            conn.getProtocol(), "?")
    except SmartcardException:
        proto = "?"

    report = {
        "Ридер": str(reader),
        "Интерфейс": interface_of(reader),
        "Протокол": proto,
        "Python": sys.version.split()[0],
    }
    try:
        report["ATR"] = hx(conn.getATR())
    except SmartcardException as exc:
        report["ATR"] = "-"
        ERRORS.append("getATR: %s" % exc)

    memory = {}
    memory_title = ""
    try:
        contact = "ICC" in str(reader).upper()
        sak = poll_card(conn, report)

        if sak in (0x08, 0x09, 0x18):
            print("[*] Mifare Classic: читаю сектора...")
            memory = read_mifare(conn, sak, report)
            memory_title = "ПАМЯТЬ - БЛОКИ MIFARE (hex)"
        elif sak == 0x00:
            print("[*] NTAG / Ultralight: читаю страницы...")
            memory = read_ntag(conn, report)
            memory_title = "ПАМЯТЬ - СТРАНИЦЫ NTAG / ULTRALIGHT (hex)"
        elif contact or sak in (0x20, 0x28):
            print("[*] ISO 7816-4 / EMV: ищу приложения (PPSE)...")
            read_emv_apps(conn, report)
    except SmartcardException as exc:
        ERRORS.append("чтение: %s" % exc)
    finally:
        try:
            conn.disconnect()
        except SmartcardException:
            pass

    if ERRORS:
        report["Ошибок при чтении"] = str(len(ERRORS))

    uid_tag = report.get("UID", "").replace(" ", "")[:14] or "CONTACT"
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = "card_report_%s_%s" % (uid_tag, stamp)

    with open(base + ".txt", "w", encoding="utf-8") as f:
        f.write(build_txt(report, memory, memory_title))
    with open(base + ".json", "w", encoding="utf-8") as f:
        json.dump({"report": report, "memory": memory, "errors": ERRORS},
                  f, ensure_ascii=False, indent=2)

    print("[+] Сохранено: %s.txt" % base)
    print("[+] Сохранено: %s.json" % base)
    if ERRORS:
        print("[!] Ошибок: %d — записаны в отчёт, скрипт не падал." % len(ERRORS))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\\n[x] Остановлено пользователем")
`;

export const REQUIREMENTS_SOURCE = `# Python 3.10 - 3.14, Windows
pyscard>=2.2.0
`;

export const RUN_BAT_SOURCE = `@echo off
chcp 65001 > nul
echo Запуск чтения карты через ACR1281U...
python acr1281_dump.py
pause
`;

/* ---------- образец отчёта ---------- */

export const SAMPLE_TXT = `============================================================
 CARD REPORT - ACR1281U (python, pyscard, v1.1)
 Дата: 2026-02-14 21:07:33
============================================================

[ ПАРАМЕТРЫ ]
  Ридер              : ACS ACR1281 2S CL Reader PICC 0
  Интерфейс          : PICC — бесконтактный (RF 13.56 МГц)
  Протокол           : T=1
  Python             : 3.14.0
  ATR                : 3B 8F 80 01 80 4F 0C A0 00 00 03 06 03 00 01 00 00 00 00 6A
  UID                : 04 A1 2B 32 4C 58 80
  Длина UID          : 7 байт
  ATQA (SENS_RES)    : 00 04
  SAK (SEL_RES)      : 08
  Тип карты          : Mifare Classic 1K
  NFCID              : 04 A1 2B 32 4C 58 80
  Режим PICC         : 106 кбит/с
  Прочитано блоков   : 52 / 64
  Секторов с ключом  : 13 / 16

[ ПАМЯТЬ - БЛОКИ MIFARE (hex) ]
  Блок 000 : 04 A1 2B 32 4C 58 80 04 58 08 04 00 00 00 12 9E
  Блок 001 : 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
  Блок 002 : 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
  Блок 003 : FF FF FF FF FF FF FF 07 80 69 FF FF FF FF FF FF
  Блок 004 : 11 22 33 44 01 00 00 00 00 00 00 00 00 00 00 1A
  Блок 005 : 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
  Блок 006 : 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
  Блок 007 : FF FF FF FF FF FF FF 07 80 69 FF FF FF FF FF FF
  ...
  Блок 060 : D4 10 06 41 00 00 00 00 00 00 00 00 00 00 00 77
  Блок 061 : 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
  Блок 062 : 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
  Блок 063 : FF FF FF FF FF FF FF 07 80 69 FF FF FF FF FF FF
`;

export const SAMPLE_JSON = `{
  "report": {
    "Ридер": "ACS ACR1281 2S CL Reader PICC 0",
    "Интерфейс": "PICC — бесконтактный (RF 13.56 МГц)",
    "Протокол": "T=1",
    "Python": "3.14.0",
    "ATR": "3B 8F 80 01 80 4F 0C A0 00 00 03 06 03 00 01 00 00 00 00 6A",
    "UID": "04 A1 2B 32 4C 58 80",
    "Длина UID": "7 байт",
    "ATQA (SENS_RES)": "00 04",
    "SAK (SEL_RES)": "08",
    "Тип карты": "Mifare Classic 1K",
    "Режим PICC": "106 кбит/с",
    "Прочитано блоков": "52 / 64",
    "Секторов с ключом": "13 / 16"
  },
  "memory": {
    "Блок 000": "04 A1 2B 32 4C 58 80 04 58 08 04 00 00 00 00 12 9E",
    "Блок 003": "FF FF FF FF FF FF FF 07 80 69 FF FF FF FF FF FF",
    "Блок 060": "D4 10 06 41 00 00 00 00 00 00 00 00 00 00 00 77"
  },
  "errors": []
}
`;

/* ---------- лог сканера (открытие) ---------- */

export interface LogLine {
  t: string;
  text: string;
  tone: "ok" | "info" | "warn" | "acc";
}

export const LOG_LINES: LogLine[] = [
  { t: "00.00", text: "Пробую: ACS ACR1281 2S CL Reader PICC 0 … подключено", tone: "info" },
  { t: "00.12", text: "PICC Polling (D4 4A)… цель в поле 13.56 МГц", tone: "info" },
  { t: "00.31", text: "ATR: 3B 8F 80 01 80 4F 0C A0 00 00 03 06 …", tone: "acc" },
  { t: "00.44", text: "UID (FF CA): 04 A1 2B 32 4C 58 80", tone: "acc" },
  { t: "00.61", text: "SAK 08 → Mifare Classic 1K", tone: "ok" },
  { t: "01.02", text: "Сектор 00 · ключ FF FF FF FF FF FF ✓", tone: "ok" },
  { t: "01.19", text: "Сектор 01 · ключ FF FF FF FF FF FF ✓", tone: "ok" },
  { t: "01.34", text: "Сектор 02 · ключ не подошёл — пропускаю", tone: "warn" },
  { t: "02.47", text: "Блоки: 52/64 · сектора: 13/16", tone: "info" },
  { t: "02.51", text: "card_report_04A12B32_20260214_210733.txt сохранён ✓", tone: "ok" },
];

/* ---------- образцы ATR ---------- */

export interface AtrSample {
  label: string;
  hex: string;
}

export const ATR_SAMPLES: AtrSample[] = [
  {
    label: "Mifare Classic 1K · ACR1281U",
    hex: "3B 8F 80 01 80 4F 0C A0 00 00 03 06 03 00 01 00 00 00 00 6A",
  },
  {
    label: "NTAG213",
    hex: "3B 8F 80 01 80 4F 0C A0 00 00 03 06 03 00 2B 00 00 00 00 40",
  },
  {
    label: "FeliCa 212K (из док. ACS)",
    hex: "3B 8F 80 01 80 4F 0C A0 00 00 03 06 03 F0 11 00 00 00 00 8A",
  },
  {
    label: "DESFire EV1 4K",
    hex: "3B 8F 80 01 80 4F 0C A0 00 00 03 06 03 00 24 00 00 00 00 4F",
  },
  {
    label: "Контактная карта (JavaCard)",
    hex: "3B 7D 96 00 00 80 31 80 65 B0 83 11 48 C8 83 00 90 00",
  },
  {
    label: "Обрезанный (ошибка)",
    hex: "3B 8F 80 01 80 4F",
  },
];

/* ---------- типы карт ACS (для псевдо-ATR) ---------- */

export const ACS_CARD_TYPES: Record<number, string> = {
  0x0001: "Mifare Classic 1K",
  0x0002: "Mifare Classic 4K",
  0x0003: "Mifare Ultralight",
  0x0004: "SLE55R-XXXX",
  0x0006: "SR176",
  0x0007: "SRIX4K",
  0x0008: "AT88SC0808CRF",
  0x0009: "AT88SC1616CRF",
  0x000a: "AT88SC3216CRF",
  0x000b: "AT88SC6416CRF",
  0x0010: "Mifare Mini",
  0x0013: "PicoPass 2K",
  0x0015: "PicoPass 16K",
  0x001d: "LRI512",
  0x0020: "Mifare DESFire",
  0x0023: "Mifare DESFire EV1 2K",
  0x0024: "Mifare DESFire EV1 4K",
  0x0025: "Mifare DESFire EV1 8K",
  0x0026: "Mifare Plus",
  0x0029: "NTAG210",
  0x002a: "NTAG212",
  0x002b: "NTAG213",
  0x002c: "NTAG215",
  0x002d: "NTAG216",
  0xf004: "Topaz / Jewel",
  0xf011: "FeliCa 212K",
};

/* ---------- FAQ ---------- */

export interface FaqItem {
  q: string;
  a: string;
  code?: string;
}

export const FAQS: FaqItem[] = [
  {
    q: "Ошибка 0x1F «устройство не работает» при передаче APDU",
    a: "Код 0x0000001F (ERROR_GEN_FAILURE) означает, что драйвер отклонил обмен: карте послана команда, которую она аппаратно не понимает — типично, когда «сырой» ISO 7816-4 SELECT (00 A4 …) уходит в NTAG/Ultralight через бесконтактный PICC-интерфейс. В v1.1 функция transmit() перехватывает такие сбои и пишет их в секцию «Ошибки» отчёта — скрипт больше не падает и файл всё равно создаётся. Для контактных EMV-карт вставьте карту в ICC-слот: скрипт сам переберёт интерфейсы PICC → ICC и выберет тот, где карта отвечает.",
    code: "APDU 00 A4 04 00 0E … -> … (0x0000001F)\n# v1.1: попадает в [ ОШИБКИ ] отчёта, чтение продолжается",
  },
  {
    q: "ModuleNotFoundError: No module named 'smartcard'",
    a: "Библиотека pyscard не установлена или установлена для другого Python. Ставьте для того же интерпретатора, которым запускаете скрипт. Для Python 3.9–3.14 под Windows есть готовые колёса — сборка из исходников не потребуется.",
    code: "python -m pip install pyscard",
  },
  {
    q: "«Ридеры не найдены» — readers() возвращает пустой список",
    a: "Служба смарт-карт Windows остановлена или драйвер не встал. Откройте services.msc, найдите службу «Смарт-карта» (Smart Card), поставьте тип запуска «Автоматически» и запустите. Затем проверьте диспетчер устройств: ридер должен быть в разделе «Устройства чтения смарт-карт» как ACS ACR1281U.",
    code: "sc config SCardSvr start= auto\nnet start SCardSvr",
  },
  {
    q: "NoCardException: карта не обнаружена",
    a: "Бесконтактную карту кладут на верхнюю площадку ридера (зона с символом волны), контактную — в щель сверху чипом вниз. Уберите карту от корпуса — металл экранирует поле 13.56 МГц. Если карта «холодная» (FeliCa/ISO-B), скрипт всё равно увидит её через Polling D4 4A.",
  },
  {
    q: "Часть секторов «ключ не подошёл»",
    a: "Это нормальная ситуация: ключи не заводские, а диверсифицированные (типично для транспорта и СКУД). Добавьте свои ключи в список FACTORY_KEYS в начале скрипта — он переберёт их автоматически. Помните: блок 0 сектора 0 (UID) у классических карт доступен только на чтение, а транспортные ключи обычно лежат в секторе 0.",
    code: 'FACTORY_KEYS = [\n    "FF FF FF FF FF FF",\n    "A1 B2 C3 D4 E5 F6",   # ваш ключ\n]',
  },
  {
    q: "Что скрипт отдаёт для банковской (контактной EMV) карты?",
    a: "ATR с историческими байтами, протокол T=0/T=1 и список AID приложений из каталога PPSE (1PAY.SYS.DDF01) — это все публичные данные карты. Номера PAN, срока действия и CVN скрипт не читает — для этого нужен сертифицированный EMV-инструментарий, а не общий дамп.",
  },
  {
    q: "Ошибка 0x80100017 / «The Smart card resource manager is not running»",
    a: "Это код SCARD_E_NO_SERVICE — диспетчер ресурсов смарт-карт не запущен. Лечится запуском службы SCardSvr (см. выше) и перетыканием USB-кабеля ридера. На некоторых сборках Windows помогает перезапуск после обновления, которое глушит службу.",
  },
];

/* ---------- поддерживаемые карты ---------- */

export interface CardRow {
  std: string;
  cards: string;
  reads: string;
}

export const CARD_ROWS: CardRow[] = [
  {
    std: "ISO 14443-A",
    cards: "Mifare Classic 1K / 4K / Mini",
    reads: "UID · ATQA · SAK · все блоки секторов (перебор заводских ключей)",
  },
  {
    std: "ISO 14443-A",
    cards: "NTAG 210–216, Mifare Ultralight",
    reads: "UID · ATQA · SAK · ATR · страницы 00-0F автоматически (Read Binary FF B0, без ключей)",
  },
  {
    std: "ISO 14443-4",
    cards: "DESFire EV1/EV2, Mifare Plus, JCOP",
    reads: "UID · ATQA · SAK · режим PICC; защищённые файлы — только с ключами",
  },
  {
    std: "ISO 14443-B",
    cards: "SR176, SRIX4K, некоторые ID",
    reads: "PUPI/UID · ATQB (через Polling D4 4A)",
  },
  {
    std: "FeliCa",
    cards: "Sony FeliCa 212/424K",
    reads: "UIDm · PMm (через Polling D4 4A)",
  },
  {
    std: "ISO 7816 T=0 / T=1",
    cards: "Банковские EMV, SIM, ID-карты",
    reads: "ATR · протокол · исторические байты · список AID из PPSE",
  },
];

/* ---------- шпаргалка APDU ---------- */

export interface CmdRow {
  apdu: string;
  name: string;
  result: string;
}

export const CMD_ROWS: CmdRow[] = [
  {
    apdu: "FF CA 00 00 00",
    name: "Get Data — UID",
    result: "UID 4/7/10 байт + SW 90 00",
  },
  {
    apdu: "FF CA 01 00 00",
    name: "Get Data — ATS",
    result: "ATS карты ISO 14443-4",
  },
  {
    apdu: "FF 00 00 00 04 D4 4A 01 00",
    name: "Polling (InListPassiveTarget)",
    result: "ATQA, SAK, NFCID — тип карты",
  },
  {
    apdu: "FF 00 00 00 04 D4 32 01 00",
    name: "Get PICC Status",
    result: "режим ридера и скорость поля",
  },
  {
    apdu: "FF 82 00 00 06 <KEY>",
    name: "Load Authentication Keys",
    result: "ключ в слот 0 для FF 86",
  },
  {
    apdu: "FF 86 00 00 05 01 00 <BLK> 60 00",
    name: "Mifare Authentication",
    result: "открытие сектора ключом A",
  },
  {
    apdu: "FF B0 00 <BLK> 10",
    name: "Read Binary",
    result: "16 байт блока <BLK>",
  },
  {
    apdu: "00 A4 04 00 0E «1PAY.SYS.DDF01»",
    name: "SELECT PPSE",
    result: "каталог EMV-приложений (контакт)",
  },
  {
    apdu: "00 B2 <REC> 0C 00",
    name: "READ RECORD",
    result: "запись EF.DIR → тег 4F (AID)",
  },
];

/* ---------- шаги установки ---------- */

export interface InstallStep {
  title: string;
  text: string;
  code?: string;
}

export const INSTALL_STEPS: InstallStep[] = [
  {
    title: "Python 3.10–3.14",
    text: "Скачайте установщик с python.org и обязательно отметьте «Add python.exe to PATH». Проверьте, что в PATH попал именно он:",
    code: "python --version",
  },
  {
    title: "Драйвер ACR1281U",
    text: "С сайта ACS → поддержка ACR1281U → драйвер «CCID Driver» для Windows. После установки в Диспетчере устройств, в разделе «Устройства чтения смарт-карт», появится ACS ACR1281U.",
  },
  {
    title: "Библиотека pyscard",
    text: "Обёртка над Windows PC/SC (winscard.dll). Для актуальных версий Python ставится одним готовым колесом:",
    code: "python -m pip install pyscard",
  },
  {
    title: "Скрипт acr1281_dump.py",
    text: "Скачайте файл кнопкой выше и положите в любую папку. Рядом можно сохранить run.bat — запуск двойным кликом.",
    code: "python acr1281_dump.py",
  },
  {
    title: "Чтение",
    text: "Положите карту на ридер и запустите скрипт. В папке появятся два файла: отчёт «параметр : значение» и его JSON-копия.",
  },
  {
    title: "Графический режим",
    text: "Не хотите консоль? acr1281_gui.py открывает окно tkinter: выбор ридера, живая таблица параметров, журнал и кнопка сохранения. Оба .py лежат в одной папке, новых зависимостей нет.",
    code: "python acr1281_gui.py",
  },
];
