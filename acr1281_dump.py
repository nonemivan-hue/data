# -*- coding: utf-8 -*-
"""
acr1281_dump.py — полное чтение параметров карты через ACR1281U (Windows, PC/SC)

Установка:  pip install pyscard
Запуск:     python acr1281_dump.py        (или python acr1281_gui.py — окно)
Результат:  card_report_<UID>_<дата>.txt   — отчёт «параметр : значение»
            card_report_<UID>_<дата>.json  — те же данные в JSON

Что читает:
  * ATR, протокол T=0/T=1, исторические байты (контактные и бесконтактные)
  * UID, ATQA (SENS_RES), SAK (SEL_RES), тип карты   — Polling D4 4A
  * тип карты из синтетического ATR, когда polling молчит  — байты H10-H11
  * статус PICC (режим, скорость)                    — D4 32
  * ATS для карт ISO 14443-4                         — FF CA 01 00
  * Mifare Classic 1K/4K/Mini: все сектора заводскими ключами
  * NTAG / Ultralight: первые страницы памяти (без аутентификации)
  * контактные EMV-карты: список приложений из PPSE (1PAY.SYS.DDF01)

История версий:
  v1.2 — исправлено ложное срабатывание «ICC внутри PICC» (интерфейсы теперь
         различаются по границе слова); если polling не вернул целей, тип
         карты определяется по синтетическому ATR (байты H10-H11, коды ACS),
         и чтение секторов Mifare продолжается; PPSE/EMV отправляются только
         на реально контактном интерфейсе.
  v1.1 — аппаратные ошибки обмена (0x1F) больше не валят скрипт: попадают в
         секцию «Ошибки»; автоперебор интерфейсов PICC -> ICC; чтение
         NTAG/Ultralight; параметры «Интерфейс», «ATS», «Python».
  v1.0 — первый выпуск.
"""

import json
import re
import sys
from datetime import datetime

from smartcard.System import readers
from smartcard.CardConnection import CardConnection
from smartcard.Exceptions import (CardConnectionException, NoCardException,
                                  SmartcardException)

VERSION = "1.2"

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

# Синтетический ATR ридеров ACS: тип карты зашит в байтах H10-H11.
# Используется, когда polling D4 4A вернул 0 целей (карта уже активирована
# PC/SC-слоем, PN532 не отдаёт её повторно).
ACS_ATR_PREFIX = [0x3B, 0x8F, 0x80, 0x01, 0x80, 0x4F, 0x0C,
                  0xA0, 0x00, 0x00, 0x03, 0x06]

# код ACS -> (название, эквивалент SAK для маршрутизации чтения)
ACS_CARD_CODES = {
    0x0001: ("Mifare Classic 1K",   0x08),
    0x0002: ("Mifare Classic 4K",   0x18),
    0x0010: ("Mifare Mini",         0x09),
    0x0003: ("Mifare Ultralight",   0x00),
    0x0029: ("NTAG210",             0x00),
    0x002A: ("NTAG212",             0x00),
    0x002B: ("NTAG213",             0x00),
    0x002C: ("NTAG215",             0x00),
    0x002D: ("NTAG216",             0x00),
    0x0020: ("Mifare DESFire",      0x20),
    0x0023: ("Mifare DESFire EV1 2K", 0x20),
    0x0024: ("Mifare DESFire EV1 4K", 0x20),
    0x0025: ("Mifare DESFire EV1 8K", 0x20),
    0x0026: ("Mifare Plus",         0x20),
    0xF004: ("Topaz / Jewel",       None),
    0xF011: ("FeliCa 212K",         None),
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


# ---------------------------------------------------------------- интерфейсы
def _is_picc(name):
    return re.search(r"\bPICC\b", str(name), re.I) is not None


def _is_icc(name):
    # \bICC\b НЕ совпадает со словом «PICC» (между P и ICC нет границы слова)
    return re.search(r"\bICC\b", str(name), re.I) is not None


def find_readers():
    """Ридеры ACR1281U (PICC первыми, затем ICC), иначе все PC/SC-ридеры."""
    found = readers()
    if not found:
        sys.exit("[!] Ридеры не найдены. Проверьте драйвер ACS CCID "
                 "и службу Windows «Смарт-карта» (scardsvr).")
    prefs = [r for r in found if "1281" in str(r).upper()] or found
    picc = [r for r in prefs if _is_picc(r)]
    icc = [r for r in prefs if _is_icc(r)]
    rest = [r for r in prefs if r not in picc and r not in icc]
    return picc + icc + rest


def interface_of(name):
    if _is_picc(name):
        return "PICC — бесконтактный (RF 13.56 МГц)"
    if _is_icc(name):
        return "ICC — контактный (слот смарт-карты)"
    if "SAM" in str(name).upper():
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
             % ("\n    Последняя ошибка: %s" % last_err if last_err else ""))


# ------------------------------------------------------------------- чтение
def detect_from_atr(atr, report):
    """Тип карты из синтетического ATR ACS (байты H10-H11). Возвращает SAK."""
    if len(atr) >= 15 and list(atr[:12]) == ACS_ATR_PREFIX:
        code = (atr[13] << 8) | atr[14]
        report["Код карты (ACS)"] = "%04X" % code
        hit = ACS_CARD_CODES.get(code)
        if hit:
            name, sak = hit
            report["Тип карты"] = name
            report["Источник типа"] = "из ATR (байты H10-H11, polling молчал)"
            return sak
    return None


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
        report["Источник типа"] = "из Polling D4 4A"
        if nlen:
            report["NFCID"] = hx(data[7:7 + nlen])
    else:
        report["ATQA (SENS_RES)"] = "- (polling вернул 0 целей)"
        report["SAK (SEL_RES)"] = "- (polling вернул 0 целей)"
        # Резервный канал: тип зашит в синтетическом ATR ридера.
        try:
            atr = conn.getATR() or []
        except SmartcardException:
            atr = []
        sak = detect_from_atr(atr, report)
        if sak is None:
            report["Тип карты"] = "не определён (нет ни polling, ни кода в ATR)"

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
    """EMV: каталог PPSE -> список AID приложений (только контактные)."""
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


# -------------------------------------------------------------------- отчёт
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
    return "\n".join(out)


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
        contact = _is_icc(reader)
        sak = poll_card(conn, report)

        if sak in (0x08, 0x09, 0x18):
            print("[*] Mifare Classic: читаю сектора...")
            memory = read_mifare(conn, sak, report)
            memory_title = "ПАМЯТЬ - БЛОКИ MIFARE (hex)"
        elif sak == 0x00:
            print("[*] NTAG / Ultralight: читаю страницы...")
            memory = read_ntag(conn, report)
            memory_title = "ПАМЯТЬ - СТРАНИЦЫ NTAG / ULTRALIGHT (hex)"
        elif contact:
            # PPSE/EMV — только на реальном контактном интерфейсе.
            print("[*] ISO 7816 / EMV: ищу приложения (PPSE)...")
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
        print("\n[x] Остановлено пользователем")
