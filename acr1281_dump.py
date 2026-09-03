# -*- coding: utf-8 -*-
"""
acr1281_dump.py — полное чтение параметров карты через ACR1281U (Windows, PC/SC)

Установка:  pip install pyscard
Запуск:     python acr1281_dump.py
Результат:  card_report_<UID>_<дата>.txt   — отчёт "параметр : значение"
            card_report_<UID>_<дата>.json  — те же данные в JSON

Что читает:
  * ATR, протокол T=0/T=1, исторические байты (контактные и бесконтактные)
  * UID, ATQA (SENS_RES), SAK (SEL_RES), тип карты  — Polling D4 4A
  * статус PICC (режим, скорость)                    — D4 32
  * Mifare Classic 1K/4K/Mini: все сектора заводскими ключами
  * контактные EMV-карты: список приложений из PPSE (1PAY.SYS.DDF01)
"""

import json
import sys
from datetime import datetime

from smartcard.System import readers
from smartcard.CardConnection import CardConnection
from smartcard.Exceptions import CardConnectionException, NoCardException

# ------------------------------------------------------------- APDU-команды
GET_UID     = [0xFF, 0xCA, 0x00, 0x00, 0x00]                          # UID карты
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


def hx(data):
    """Список байтов -> строка 'FF 00 3A'."""
    return " ".join("%02X" % b for b in data) if data else "-"


def transmit(conn, apdu):
    """Отправить APDU, вернуть (данные, SW1SW2)."""
    data, sw1, sw2 = conn.transmit(list(apdu))
    return data, (sw1 << 8) | sw2


def find_reader():
    """Найти ACR1281U или взять первый доступный PC/SC-ридер."""
    found = readers()
    if not found:
        sys.exit("[!] Ридеры не найдены. Проверьте драйвер ACS CCID "
                 "и службу Windows 'Смарт-карта' (scardsvr).")
    for r in found:
        if "1281" in str(r).upper():
            return r
    print("[~] ACR1281U не найден, беру первый ридер: %s" % found[0])
    return found[0]


def poll_card(conn, report):
    """Бесконтактная часть: UID, ATQA, SAK, тип. Возвращает SAK или None."""
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
                blocks[first + i] = hx(data)
                read_ok += 1

    report["Прочитано блоков"] = "%d / %d" % (read_ok, total_blocks)
    report["Секторов с ключом"] = "%d / %d" % (keys_ok, sectors)
    return blocks


def read_emv_apps(conn, report):
    """Контактные EMV: каталог PPSE -> список AID приложений."""
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


def build_txt(report, blocks):
    """Собрать текстовый отчёт: параметр : значение."""
    w = max(len(k) for k in report) + 2 if report else 20
    out = [
        "=" * 60,
        " CARD REPORT - ACR1281U (python, pyscard)",
        " Дата: " + datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "=" * 60,
        "",
        "[ ПАРАМЕТРЫ ]",
    ]
    for k, v in report.items():
        out.append("  %-*s : %s" % (w, k, v))
    if blocks:
        out += ["", "[ ПАМЯТЬ - БЛОКИ MIFARE (hex) ]"]
        for blk in sorted(blocks):
            out.append("  Блок %03d : %s" % (blk, blocks[blk]))
    out.append("")
    return "\n".join(out)


def main():
    print("=" * 60)
    print("  ACR1281U · ПОЛНОЕ ЧТЕНИЕ ПАРАМЕТРОВ КАРТЫ")
    print("=" * 60)

    reader = find_reader()
    print("[*] Ридер: %s" % reader)

    conn = reader.createConnection()
    try:
        conn.connect(CardConnection.T0_protocol | CardConnection.T1_protocol)
    except NoCardException:
        sys.exit("[!] Карта не обнаружена. Положите её на ридер и повторите.")
    except CardConnectionException as exc:
        sys.exit("[!] Ошибка соединения: %s" % exc)

    proto = {0: "direct", 1: "T=0", 2: "T=1", 3: "T=0+T=1"}.get(
        conn.getProtocol(), "?")

    report = {
        "Ридер": str(reader),
        "Протокол": proto,
        "ATR": hx(conn.getATR()),
    }

    sak = poll_card(conn, report)

    blocks = {}
    if sak in (0x08, 0x09, 0x18):
        print("[*] Mifare Classic: читаю сектора...")
        blocks = read_mifare(conn, sak, report)
    else:
        read_emv_apps(conn, report)

    uid_tag = report.get("UID", "").replace(" ", "")[:14] or "CONTACT"
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = "card_report_%s_%s" % (uid_tag, stamp)

    with open(base + ".txt", "w", encoding="utf-8") as f:
        f.write(build_txt(report, blocks))
    with open(base + ".json", "w", encoding="utf-8") as f:
        json.dump({"report": report, "blocks": blocks},
                  f, ensure_ascii=False, indent=2)

    print("[+] Сохранено: %s.txt" % base)
    print("[+] Сохранено: %s.json" % base)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[x] Остановлено пользователем")
