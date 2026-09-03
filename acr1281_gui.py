# -*- coding: utf-8 -*-
"""
acr1281_gui.py — графический интерфейс для чтения карт ACR1281U (v2.0, tkinter)

Запуск:      python acr1281_gui.py
Требования:  рядом должен лежать acr1281_dump.py (общее ядро чтения v1.2),
             установленный pyscard. tkinter входит в состав Python (Windows).

Возможности:
  * выбор ридера (PICC/ICC) и автоперебор интерфейсов;
  * сканирование в фоновом потоке — окно не зависает;
  * живая таблица «параметр : значение» (двойной клик — копирование);
  * вкладка «Память»: hex-сетка блоков/страниц со статусом ключей и
    поиском по дампу (hex или ASCII) — например, длинных номеров;
  * вкладка «ATR»: побайтовый разбор ответа на сброс (включая тип карты
    из синтетического ATR ACS, байты H10-H11);
  * вкладка «Журнал»: события ok / warn / err со временем;
  * сохранение отчёта (.txt «параметр : значение» + .json) и открытие
    сохранённого отчёта обратно в окно.
"""

import json
import os
import queue
import re
import sys
import threading
import tkinter as tk
from datetime import datetime
from tkinter import filedialog, ttk

from smartcard.CardConnection import CardConnection
from smartcard.Exceptions import (CardConnectionException, NoCardException,
                                  SmartcardException)

import acr1281_dump as core

GUI_VERSION = "2.0"

# ------------------------------------------------------------------ палитра
INK = "#0d1b26"
PAPER = "#eef1f2"
ACC = "#f0561c"
AMBER = "#f2a51b"
LED_GREEN = "#2ebd6b"
LED_GRAY = "#8a9aa5"
NIGHT = "#101c26"

TAG_COLORS = {
    "ok": "#dff2e6",
    "fail": "#fbe4e0",
    "trailer": "#fdf0d3",
    "hit": "#ffd9c2",
    "plain": "#ffffff",
}


# ------------------------------------------------------------- разбор ATR
def acs_hist_detail(j, hist):
    if hist and hist[0] == 0x80:
        table = {
            0: "индикатор категории 80 (ISO 7816-4)",
            1: "тег 4F — есть AID", 2: "длина поля данных",
            9: "тип карты, старший байт", 10: "тип карты, младший байт",
        }
        if 3 <= j <= 7:
            return "RID A0 00 00 03 06 — PC/SC Workgroup"
        if j == 8:
            return "байт стандарта: 03 = ISO 14443-3"
        return table.get(j, "RFU — зарезервировано")
    return "байт ATS / ATQB (ISO 14443-4)"


def atr_decode(b):
    """ATR -> список строк (имя, hex, пояснение)."""
    rows = []
    if not b:
        return [("ATR", "-", "карта не вернула ATR")]
    h2 = lambda x: "%02X" % x
    rows.append(("TS", h2(b[0]),
                 "прямая конвенция" if b[0] == 0x3B else
                 "обратная конвенция" if b[0] == 0x3F else "ошибка TS"))
    if len(b) < 2:
        return rows
    t0 = b[1]
    K = t0 & 0x0F
    rows.append(("T0", h2(t0), "Y1=%s, K=%d исторических байт"
                 % (format(t0 >> 4, "04b"), K)))

    # синтетический ATR ридеров ACS (по спеке: TD1=80, TD2=01, TCK в конце)
    if (t0 >> 4) == 0x8 and len(b) >= 4 and b[2] == 0x80 and b[3] == 0x01:
        rows.append(("TD1", "80", "по спецификации ACS: дальше TD2"))
        rows.append(("TD2", "01", "протокол T=1, последний байт — TCK"))
        h0 = 4
        hist = list(b[h0:h0 + K])
        for i, v in enumerate(hist):
            rows.append(("H%d" % (i + 1), h2(v), acs_hist_detail(i, hist)))
        if len(b) > h0 + K:
            tck = b[h0 + K]
            x = 0
            for v in b[1:h0 + K]:
                x ^= v
            rows.append(("TCK", h2(tck),
                         "XOR(T0..H) совпадает — верно" if x == tck
                         else "ошибка: XOR=%s" % h2(x)))
        if len(hist) >= 11 and hist[0] == 0x80:
            code = (hist[9] << 8) | hist[10]
            hit = core.ACS_CARD_CODES.get(code)
            rows.append(("TIP", "%04X" % code,
                         "тип карты ACS: %s" % hit[0] if hit
                         else "кода нет в таблице ACS"))
        return rows

    # общий случай ISO 7816-3
    i = 2
    Y = t0 >> 4
    n = 1
    while Y and i < len(b):
        for bit, name in ((8, "TA%d" % n), (4, "TB%d" % n), (2, "TC%d" % n)):
            if (Y & bit) and i < len(b):
                rows.append((name, h2(b[i]), "интерфейсный символ"))
                i += 1
        if (Y & 1) and i < len(b):
            Y = b[i] >> 4
            rows.append(("TD%d" % n, h2(b[i]), "протокол T=%d" % (b[i] & 0xF)))
            n += 1
            i += 1
        else:
            Y = 0
    for j in range(min(K, len(b) - i)):
        rows.append(("H%d" % (j + 1), h2(b[i + j]), "исторический байт"))
    return rows


# ------------------------------------------------------------------ окно
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ACR1281U — чтение карты  (GUI v%s, ядро v%s)"
                   % (GUI_VERSION, core.VERSION))
        self.geometry("1100x660")
        self.minsize(960, 560)
        self.configure(background=PAPER)

        self.queue = queue.Queue()
        self.working = False
        self.report = {}
        self.mem_hex = {}          # label -> hex (для сохранения)
        self.mem_tags = {}         # id строки -> базовый тег
        self.memory_title = ""
        self.errors = []
        self.atr_bytes = []

        self._style()
        self._toolbar()
        self._body()
        self._statusbar()
        self.after(100, self._poll)
        self.log("info", "Готово. Выберите ридер и нажмите «Сканировать карту».")

    # ------------------------------------------------- стиль
    def _style(self):
        st = ttk.Style(self)
        st.theme_use("clam")
        st.configure("TFrame", background=PAPER)
        st.configure("TLabel", background=PAPER, foreground=INK)
        st.configure("Hdr.TLabel", background=PAPER, foreground=INK,
                     font=("Segoe UI", 9, "bold"))
        st.configure("TButton", padding=(10, 5))
        st.configure("Acc.TButton", foreground="white", background=ACC,
                     font=("Segoe UI", 9, "bold"), padding=(14, 5))
        st.map("Acc.TButton", background=[("active", "#c74312")])

        st.configure("Treeview", rowheight=24, fieldbackground="#ffffff",
                     foreground=INK, borderwidth=0)
        st.configure("Treeview.Heading", background=INK, foreground="#eef1f2",
                     relief="flat", font=("Segoe UI", 9, "bold"))
        st.map("Treeview", background=[("selected", "#d7e3ea")])

        st.configure("Params.Treeview", font=("Consolas", 10))
        st.configure("Mem.Treeview", font=("Consolas", 10))
        st.configure("Atr.Treeview", font=("Consolas", 10))

        st.configure("Log.Treeview", background=NIGHT, fieldbackground=NIGHT,
                     foreground="#d7e3ea", font=("Consolas", 10), rowheight=22)
        st.configure("Log.Treeview.Heading", background="#16283a")
        st.map("Log.Treeview", background=[("selected", "#1c3040")])

        st.configure("Dark.TFrame", background=NIGHT)
        st.configure("Dark.TLabel", background=NIGHT, foreground="#9fb3c0",
                     font=("Consolas", 9))
        st.configure("Acc.TEntry", fieldbackground="#ffffff")

    # ------------------------------------------------- тулбар
    def _toolbar(self):
        bar = ttk.Frame(self)
        bar.pack(fill="x", padx=10, pady=(10, 4))

        ttk.Label(bar, text="Ридер:", style="Hdr.TLabel").pack(side="left")
        self.reader_var = tk.StringVar()
        self.reader_box = ttk.Combobox(bar, textvariable=self.reader_var,
                                       state="readonly", width=46)
        self.reader_box.pack(side="left", padx=(6, 2))

        ttk.Button(bar, text="Обновить", command=self.on_refresh).pack(side="left")

        self.scan_btn = ttk.Button(bar, text="Сканировать карту",
                                   style="Acc.TButton", command=self.on_scan)
        self.scan_btn.pack(side="left", padx=(10, 2))

        ttk.Button(bar, text="Сохранить отчёт…",
                   command=self.on_save).pack(side="right", padx=(2, 0))
        ttk.Button(bar, text="Открыть отчёт…",
                   command=self.on_open).pack(side="right")

        self.on_refresh()

    # ------------------------------------------------- основная область
    def _body(self):
        body = ttk.Frame(self)
        body.pack(fill="both", expand=True, padx=10, pady=6)

        # левая колонка — параметры
        left = ttk.Frame(body)
        left.pack(side="left", fill="both", expand=True)
        ttk.Label(left, text="ПАРАМЕТРЫ  (двойной клик — копировать значение)",
                  style="Hdr.TLabel").pack(anchor="w", pady=(0, 3))
        self.params = ttk.Treeview(left, columns=("k", "v"), show="headings",
                                   style="Params.Treeview")
        self.params.heading("k", text="Параметр")
        self.params.heading("v", text="Значение")
        self.params.column("k", width=190, stretch=False)
        self.params.column("v", width=420)
        self.params.pack(fill="both", expand=True)
        self.params.bind("<Double-1>", self._copy_param)

        # правая колонка — вкладки
        right = ttk.Frame(body)
        right.pack(side="left", fill="both", expand=True, padx=(8, 0))
        self.nb = ttk.Notebook(right)
        self.nb.pack(fill="both", expand=True)

        # --- Память
        mem_tab = ttk.Frame(self.nb)
        self.nb.add(mem_tab, text="  Память  ")
        search_bar = ttk.Frame(mem_tab)
        search_bar.pack(fill="x", pady=(6, 4))
        ttk.Label(search_bar, text="Поиск в дампе:",
                  style="Hdr.TLabel").pack(side="left")
        self.search_var = tk.StringVar()
        ttk.Entry(search_bar, textvariable=self.search_var, width=26,
                  style="Acc.TEntry").pack(side="left", padx=6)
        self.search_mode = tk.StringVar(value="ascii")
        ttk.Radiobutton(search_bar, text="ASCII", variable=self.search_mode,
                        value="ascii").pack(side="left")
        ttk.Radiobutton(search_bar, text="Hex", variable=self.search_mode,
                        value="hex").pack(side="left", padx=(2, 6))
        ttk.Button(search_bar, text="Найти", command=self.on_search).pack(side="left")
        ttk.Button(search_bar, text="Сброс", command=self.on_search_reset).pack(side="left", padx=4)
        self.search_lbl = ttk.Label(search_bar, text="", foreground="#5d7a8f")
        self.search_lbl.pack(side="left", padx=10)

        self.mem = ttk.Treeview(mem_tab, columns=("blk", "hex", "note"),
                                show="headings", style="Mem.Treeview")
        self.mem.heading("blk", text="Блок / строка")
        self.mem.heading("hex", text="Данные (hex)")
        self.mem.heading("note", text="Примечание")
        self.mem.column("blk", width=150, stretch=False)
        self.mem.column("hex", width=430)
        self.mem.column("note", width=220)
        for tag, color in TAG_COLORS.items():
            self.mem.tag_configure(tag, background=color)
        self.mem.pack(fill="both", expand=True, pady=(0, 6))

        # --- ATR
        atr_tab = ttk.Frame(self.nb)
        self.nb.add(atr_tab, text="  ATR  ")
        ttk.Label(atr_tab, text="Побайтовый разбор ответа на сброс",
                  style="Hdr.TLabel").pack(anchor="w", pady=(6, 3))
        self.atr = ttk.Treeview(atr_tab, columns=("name", "hex", "det"),
                                show="headings", style="Atr.Treeview")
        self.atr.heading("name", text="Символ")
        self.atr.heading("hex", text="Hex")
        self.atr.heading("det", text="Значение")
        self.atr.column("name", width=80, stretch=False)
        self.atr.column("hex", width=70, stretch=False)
        self.atr.column("det", width=560)
        self.atr.pack(fill="both", expand=True, pady=(0, 6))

        # --- Журнал
        log_tab = ttk.Frame(self.nb)
        self.nb.add(log_tab, text="  Журнал  ")
        log_tab.configure(style="Dark.TFrame")
        self.logview = ttk.Treeview(log_tab, columns=("t", "msg"),
                                    show="headings", style="Log.Treeview")
        self.logview.heading("t", text="Время")
        self.logview.heading("msg", text="Событие")
        self.logview.column("t", width=90, stretch=False)
        self.logview.column("msg", width=620)
        for level, color in (("ok", LED_GREEN), ("warn", AMBER),
                             ("err", ACC), ("info", "#9fb3c0")):
            self.logview.tag_configure(level, foreground=color)
        self.logview.pack(fill="both", expand=True, padx=2, pady=(2, 6))

    # ------------------------------------------------- статус-бар
    def _statusbar(self):
        bar = tk.Frame(self, background=INK, height=34)
        bar.pack(fill="x", side="bottom")
        bar.pack_propagate(False)

        self.led = tk.Canvas(bar, width=14, height=14, bg=INK,
                             highlightthickness=0)
        self.led_id = self.led.create_oval(2, 2, 12, 12, fill=LED_GRAY,
                                           outline="")
        self.led.pack(side="left", padx=(12, 6), pady=9)

        self.status_var = tk.StringVar(value="Готово.")
        tk.Label(bar, textvariable=self.status_var, bg=INK, fg="#d7e3ea",
                 font=("Segoe UI", 9)).pack(side="left")

        self.counter_var = tk.StringVar(value="")
        tk.Label(bar, textvariable=self.counter_var, bg=INK, fg=AMBER,
                 font=("Consolas", 9, "bold")).pack(side="right", padx=12)

        self.progress = ttk.Progressbar(bar, length=180, mode="indeterminate")
        self.progress.pack(side="right", padx=10, pady=9)

    def set_led(self, on):
        self.led.itemconfig(self.led_id, fill=LED_GREEN if on else LED_GRAY)

    # ------------------------------------------------- события из потока
    def _poll(self):
        try:
            while True:
                ev = self.queue.get_nowait()
                self._handle(ev)
        except queue.Empty:
            pass
        self.after(100, self._poll)

    def _handle(self, ev):
        kind = ev[0]
        if kind == "param":
            self.add_param(ev[1], ev[2])
        elif kind == "log":
            self.log(ev[1], ev[2])
        elif kind == "mem":
            self.add_mem(ev[1], ev[2], ev[3], ev[4])
        elif kind == "atr":
            self.fill_atr(ev[1])
        elif kind == "status":
            self.status_var.set(ev[1])
        elif kind == "count":
            self.counter_var.set(ev[1])
        elif kind == "busy":
            self.working = ev[1]
            self.scan_btn.configure(state="disabled" if ev[1] else "normal")
            if ev[1]:
                self.set_led(True)
                self.progress.start(12)
            else:
                self.set_led(False)
                self.progress.stop()
        elif kind == "fatal":
            self.log("err", ev[1])
            self.status_var.set("Ошибка — подробности в журнале.")

    # ------------------------------------------------- наполнение
    def add_param(self, k, v):
        self.report[k] = v
        self.params.insert("", "end", values=(k, v))
        self.params.yview_moveto(1.0)

    def add_mem(self, label, hexstr, note, tag="plain"):
        self.mem_hex[label] = hexstr
        iid = self.mem.insert("", "end", values=(label, hexstr, note),
                              tags=(tag,))
        self.mem_tags[iid] = tag
        self.mem.yview_moveto(1.0)

    def fill_atr(self, rows):
        for row in self.atr.get_children():
            self.atr.delete(row)
        for name, hexs, det in rows:
            self.atr.insert("", "end", values=(name, hexs, det))

    def log(self, level, text):
        t = datetime.now().strftime("%H:%M:%S")
        self.logview.insert("", "end", values=(t, text), tags=(level,))
        self.logview.yview_moveto(1.0)

    def _copy_param(self, _event=None):
        sel = self.params.selection()
        if not sel:
            return
        k, v = self.params.item(sel[0], "values")
        self.clipboard_clear()
        self.clipboard_append(v)
        self.log("info", "Скопировано: %s = %s" % (k, v))

    # ------------------------------------------------- действия
    def on_refresh(self):
        names = [str(r) for r in core.find_readers()]
        self.reader_box["values"] = names
        if names:
            self.reader_box.current(0)
            self.log("info", "Найдено ридеров: %d" % len(names))
        else:
            self.log("err", "Ридеры не найдены — драйвер / служба «Смарт-карта».")

    def on_scan(self):
        name = self.reader_var.get()
        if not name or self.working:
            return
        for tree in (self.params, self.mem, self.atr):
            for row in tree.get_children():
                tree.delete(row)
        for iid in list(self.mem_tags):
            del self.mem_tags[iid]
        self.report, self.mem_hex, self.errors = {}, {}, []
        self.mem_tags = {}
        self.memory_title = ""
        self.atr_bytes = []
        self.search_lbl.configure(text="")
        self.queue.put(("busy", True))
        self.queue.put(("status", "Чтение карты…"))
        threading.Thread(target=self._worker, args=(name,), daemon=True).start()

    # ------------------------------------------------- фоновое чтение
    def _worker(self, reader_name):
        send = self.queue.put
        conn = None
        try:
            from smartcard.System import readers as pcsc_readers
            reader = None
            for r in pcsc_readers():
                if str(r) == reader_name:
                    reader = r
                    break
            if reader is None:
                send(("fatal", "Ридер «%s» исчез из системы." % reader_name))
                return

            conn = reader.createConnection()
            conn.connect(CardConnection.T0_protocol | CardConnection.T1_protocol)
            send(("log", "ok", "Подключено: " + reader_name))

            def add(k, v):
                self.report[k] = v
                send(("param", k, v))

            def tx(apdu):
                try:
                    data, sw1, sw2 = conn.transmit(list(apdu))
                    return data, (sw1 << 8) | sw2
                except SmartcardException as exc:
                    self.errors.append("APDU %s -> %s" % (core.hx(apdu), exc))
                    send(("log", "err", "Сбой обмена APDU: %s" % exc))
                    return [], 0x6F00

            add("Ридер", str(reader))
            add("Интерфейс", core.interface_of(reader))
            add("Протокол", {0: "direct", 1: "T=0", 2: "T=1",
                             3: "T=0+T=1"}.get(conn.getProtocol(), "?"))
            add("Python", sys.version.split()[0])

            try:
                self.atr_bytes = list(conn.getATR() or [])
            except SmartcardException as exc:
                self.atr_bytes = []
                self.errors.append("getATR: %s" % exc)
            add("ATR", core.hx(self.atr_bytes))
            send(("atr", atr_decode(self.atr_bytes)))
            send(("log", "info", "ATR: %d байт — разбор на вкладке «ATR»"
                  % len(self.atr_bytes)))

            # ---------------- UID
            uid, sw = tx(core.GET_UID)
            if sw == 0x9000 and uid:
                add("UID", core.hx(uid))
                add("Длина UID", "%d байт" % len(uid))
                send(("log", "info", "UID: " + core.hx(uid)))

            # ---------------- тип карты: polling, затем ATR
            contact = core._is_icc(reader)
            sak = None
            data, sw = tx(core.PICC_POLL)
            if sw == 0x9000 and len(data) >= 7 and data[0] == 0xD5 and data[2] > 0:
                sens, sak = data[3:5], data[5]
                add("ATQA (SENS_RES)", core.hx(sens))
                add("SAK (SEL_RES)", "%02X" % sak)
                add("Тип карты", core.SAK_TYPES.get(
                    sak, "неизвестен (SAK=%02X)" % sak))
                add("Источник типа", "из Polling D4 4A")
                send(("log", "ok", "Тип карты: " +
                      core.SAK_TYPES.get(sak, "SAK=%02X" % sak)))
            elif not contact:
                add("ATQA (SENS_RES)", "- (polling вернул 0 целей)")
                add("SAK (SEL_RES)", "- (polling вернул 0 целей)")
                before = set(self.report)
                sak = core.detect_from_atr(self.atr_bytes, self.report)
                for k in ("Код карты (ACS)", "Тип карты", "Источник типа"):
                    if k in self.report and k not in before:
                        send(("param", k, self.report[k]))
                if sak is not None:
                    send(("log", "ok", "Тип карты: %s (из ATR, H10-H11)"
                          % self.report.get("Тип карты")))
                else:
                    add("Тип карты", "не определён (нет ни polling, ни кода в ATR)")

            data, sw = tx(core.PICC_STATUS)
            if sw == 0x9000 and len(data) >= 5:
                modes = {0x00: "авто", 0x01: "106 кбит/с", 0x02: "212 кбит/с",
                         0x04: "424 кбит/с", 0x08: "848 кбит/с"}
                add("Режим PICC", modes.get(data[2], "%02X" % data[2]))

            if sak in (0x20, 0x28):
                ats, sw = tx(core.GET_ATS)
                if sw == 0x9000 and ats:
                    add("ATS", core.hx(ats))

            # ---------------- память
            if sak in (0x08, 0x09, 0x18):
                self.memory_title = "ПАМЯТЬ - БЛОКИ MIFARE (hex)"
                self._mifare(tx, sak, add, send)
            elif sak == 0x00:
                self.memory_title = "ПАМЯТЬ - СТРАНИЦЫ NTAG / ULTRALIGHT (hex)"
                self._ntag(tx, add, send)
            elif contact:
                send(("status", "Поиск EMV-приложений (PPSE)…"))
                self._emv(tx, add, send)

            if self.errors:
                add("Ошибок при чтении", str(len(self.errors)))
            send(("log", "ok",
                  "Готово. Параметров: %d, строк памяти: %d, ошибок: %d"
                  % (len(self.report), len(self.mem_hex), len(self.errors))))
            send(("status", "Готово. «Сохранить отчёт…» — файлы .txt и .json."))
        except NoCardException:
            send(("fatal", "Карта не обнаружена — положите её на ридер."))
        except CardConnectionException as exc:
            send(("fatal", "Ошибка соединения: %s" % exc))
        except SmartcardException as exc:
            send(("fatal", "Ошибка PC/SC: %s" % exc))
        except Exception as exc:  # страховка: окно не должно падать
            send(("fatal", "Непредвиденная ошибка: %s" % exc))
        finally:
            if conn is not None:
                try:
                    conn.disconnect()
                except SmartcardException:
                    pass
            send(("busy", False))

    def _mifare(self, tx, sak, add, send):
        sectors = {0x18: 40, 0x09: 5}.get(sak, 16)
        send(("status", "Чтение секторов Mifare…"))
        read_ok = keys_ok = total = 0
        for sec in range(sectors):
            if sectors == 40 and sec >= 32:
                first, count = 128 + (sec - 32) * 16, 16
            else:
                first, count = sec * 4, 4
            total += count
            opened = False
            for key in core.FACTORY_KEYS:
                kb = [int(x, 16) for x in key.split()]
                if tx(core.LOAD_KEY(kb))[1] != 0x9000:
                    continue
                if tx(core.AUTH_KEY_A(first))[1] == 0x9000:
                    opened = True
                    keys_ok += 1
                    send(("log", "ok", "Сектор %02d · ключ %s" % (sec, key)))
                    break
            if not opened:
                send(("log", "warn", "Сектор %02d · ключ не подошёл" % sec))
                send(("mem", "Сектор %02d" % sec, "-", "ключ не подошёл", "fail"))
                send(("count", "Сектора %d/%d · Блоки %d/%d"
                      % (sec + 1, sectors, read_ok, total)))
                continue
            per = 16 if count == 16 else 4
            for i in range(count):
                blk = first + i
                data, sw = tx(core.READ_BLOCK(blk))
                is_trailer = (i == per - 1)
                note = ("трейлер (ключи/AC)" if is_trailer
                        else "сектор %02d · ключ A" % sec)
                tag = "trailer" if is_trailer else "ok"
                if sw == 0x9000:
                    read_ok += 1
                    self.add_mem("Блок %03d" % blk, core.hx(data), note, tag)
                    send(("mem", "Блок %03d" % blk, core.hx(data), note, tag))
                else:
                    self.add_mem("Блок %03d" % blk, "-", "ошибка чтения", "fail")
                    send(("mem", "Блок %03d" % blk, "-", "ошибка чтения", "fail"))
            send(("count", "Сектора %d/%d · Блоки %d/%d"
                  % (sec + 1, sectors, read_ok, total)))
        add("Прочитано блоков", "%d / %d" % (read_ok, total))
        add("Секторов с ключом", "%d / %d" % (keys_ok, sectors))

    def _ntag(self, tx, add, send):
        send(("status", "Чтение страниц NTAG / Ultralight…"))
        got = 0
        for start in (0x00, 0x04, 0x08, 0x0C):
            data, sw = tx(core.READ_BLOCK(start))
            label = "Стр. %02X-%02X" % (start, start + 3)
            if sw == 0x9000:
                got += 1
                self.add_mem(label, core.hx(data), "без аутентификации", "ok")
                send(("mem", label, core.hx(data), "без аутентификации", "ok"))
            else:
                self.add_mem(label, "-", "не читается", "fail")
                send(("mem", label, "-", "не читается", "fail"))
            send(("count", "Страницы %d/4" % got))
        if got:
            add("Страниц прочитано", "%d по 4 (00-0F), 16 байт" % got)

    def _emv(self, tx, add, send):
        ppse = [0x00, 0xA4, 0x04, 0x00, 0x0E] + list(b"1PAY.SYS.DDF01")
        if tx(ppse)[1] != 0x9000:
            send(("log", "warn", "PPSE не ответил — EMV-каталог недоступен."))
            return
        n = 0
        for rec in range(1, 11):
            data, sw = tx([0x00, 0xB2, rec, 0x0C, 0x00])
            if sw != 0x9000:
                break
            i = 0
            while i + 1 < len(data):
                tag, ln = data[i], data[i + 1]
                if tag == 0x4F and i + 2 + ln <= len(data):
                    n += 1
                    add("Приложение %d (AID)" % n, core.hx(data[i + 2:i + 2 + ln]))
                    send(("log", "ok", "EMV AID: " + core.hx(data[i + 2:i + 2 + ln])))
                    break
                i += 2 + ln

    # ------------------------------------------------- поиск по дампу
    def _mem_blob(self):
        blob = bytearray()
        spans = []  # (start, end, iid)
        for iid in self.mem.get_children():
            label, hexstr, _ = self.mem.item(iid, "values")
            h = re.sub(r"[^0-9a-fA-F]", "", hexstr)
            try:
                raw = bytes.fromhex(h)
            except ValueError:
                continue
            if not raw:
                continue
            spans.append((len(blob), len(blob) + len(raw), iid))
            blob += raw
        return bytes(blob), spans

    def on_search(self):
        q = self.search_var.get().strip()
        if not q:
            self.search_lbl.configure(text="введите номер / строку / hex")
            return
        if self.search_mode.get() == "hex":
            h = re.sub(r"[^0-9a-fA-F]", "", q)
            if len(h) % 2:
                h += "0"
            try:
                needle = bytes.fromhex(h)
            except ValueError:
                self.search_lbl.configure(text="некорректный hex")
                return
        else:
            needle = q.encode("latin-1", "ignore")
        if not needle:
            self.search_lbl.configure(text="пустой запрос")
            return

        blob, spans = self._mem_blob()
        if not blob:
            self.search_lbl.configure(text="в памяти пока пусто")
            return

        hits, pos = [], 0
        while True:
            pos = blob.find(needle, pos)
            if pos < 0:
                break
            hits.append(pos)
            pos += 1

        for iid, tag in self.mem_tags.items():
            self.mem.item(iid, tags=(tag,))
        hit_rows = []
        for off in hits:
            for start, end, iid in spans:
                if start <= off < end:
                    self.mem.item(iid, tags=("hit",))
                    if iid not in hit_rows:
                        hit_rows.append(iid)
                    break
        if hits:
            offs = ", ".join("0x%04X" % o for o in hits[:6])
            if len(hits) > 6:
                offs += "…"
            self.search_lbl.configure(
                text="найдено %d · строки: %d · смещения: %s"
                % (len(hits), len(hit_rows), offs))
            self.log("ok", "Поиск «%s»: %d совпадений (%s)" % (q, len(hits), offs))
            if hit_rows:
                self.mem.see(hit_rows[0])
        else:
            self.search_lbl.configure(
                text="не найдено (%d байт запроса, %d байт в дампе)"
                % (len(needle), len(blob)))
            self.log("warn", "Поиск «%s»: совпадений нет." % q)

    def on_search_reset(self):
        for iid, tag in self.mem_tags.items():
            self.mem.item(iid, tags=(tag,))
        self.search_var.set("")
        self.search_lbl.configure(text="")

    # ------------------------------------------------- отчёты
    def on_save(self):
        if not self.report:
            self.log("warn", "Нечего сохранять — сначала прочитайте карту.")
            return
        uid = self.report.get("UID", "").replace(" ", "")[:14] or "CONTACT"
        default = "card_report_%s_%s.txt" % (
            uid, datetime.now().strftime("%Y%m%d_%H%M%S"))
        path = filedialog.asksaveasfilename(
            defaultextension=".txt", initialfile=default,
            filetypes=[("Отчёт", "*.txt"), ("Все файлы", "*.*")])
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(core.build_txt(self.report, self.mem_hex,
                                       self.memory_title or "ПАМЯТЬ (hex)"))
            json_path = os.path.splitext(path)[0] + ".json"
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump({"report": self.report, "memory": self.mem_hex,
                           "errors": self.errors},
                          f, ensure_ascii=False, indent=2)
            self.log("ok", "Сохранено: %s (+ .json)" % os.path.basename(path))
            self.status_var.set("Отчёт сохранён: " + os.path.basename(path))
        except OSError as exc:
            self.log("err", "Не удалось сохранить: %s" % exc)

    def on_open(self):
        path = filedialog.askopenfilename(
            filetypes=[("Отчёты", "*.txt"), ("Все файлы", "*.*")])
        if not path:
            return
        for tree in (self.params, self.mem):
            for row in tree.get_children():
                tree.delete(row)
        self.report, self.mem_hex = {}, {}
        self.mem_tags = {}
        section = None
        try:
            with open(path, encoding="utf-8") as f:
                lines = f.read().splitlines()
        except OSError as exc:
            self.log("err", "Не удалось открыть: %s" % exc)
            return
        for line in lines:
            if line.startswith("[ ПАМЯТЬ"):
                section = "mem"
                continue
            if line.startswith("["):
                section = None
                continue
            m = re.match(r"\s+(.+?)\s*:\s(.*)$", line)
            if not m:
                continue
            k, v = m.group(1).strip(), m.group(2).strip()
            if section == "mem":
                self.add_mem(k, v, "из файла", "plain")
            else:
                self.add_param(k, v)
        self.log("info", "Открыт отчёт: %s (%d параметров)"
                 % (os.path.basename(path), len(self.report)))
        self.status_var.set("Открыт: " + os.path.basename(path))


def main():
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
