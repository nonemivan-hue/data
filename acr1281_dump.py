# -*- coding: utf-8 -*-
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
             % ("\n    Последняя ошибка: %s" % last_err if last_err else ""))


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
        print("\n[x] Остановлено пользователем")
