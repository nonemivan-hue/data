# -*- coding: utf-8 -*-
"""
acr1281_gui.py — графический интерфейс чтения карт через ACR1281U (Windows)

Использует логику acr1281_dump.py (v1.1) — держите оба файла в одной папке.
tkinter входит в состав Python под Windows, поэтому новых зависимостей
кроме pyscard не появляется.

Запуск GUI:          python acr1281_gui.py
Консольная версия:   python acr1281_dump.py
"""

import json
import queue
import sys
import threading
import tkinter as tk
from datetime import datetime
from tkinter import filedialog, messagebox, ttk

try:
    import acr1281_dump as core
except ImportError:
    sys.exit("[!] Файл acr1281_dump.py не найден рядом с acr1281_gui.py.")

from smartcard.CardConnection import CardConnection
from smartcard.Exceptions import (CardConnectionException, NoCardException,
                                  SmartcardException)
from smartcard.System import readers

ACCENT = "#e8501d"
C_OK = "#1e7a46"
C_WARN = "#a86a00"
C_ERR = "#c0392b"

ACS_TYPES = {
    0x0001: "Mifare Classic 1K", 0x0002: "Mifare Classic 4K",
    0x0003: "Mifare Ultralight", 0x0010: "Mifare Mini",
    0x0020: "Mifare DESFire", 0x0026: "Mifare Plus",
    0x002b: "NTAG213", 0x002c: "NTAG215", 0x002d: "NTAG216",
    0xf004: "Topaz / Jewel", 0xf011: "FeliCa 212K",
}


def atr_note(atr):
    """Человекочитаемая заметка об ATR одной строкой."""
    if not atr:
        return ""
    if list(atr[:4]) == [0x3B, 0x8F, 0x80, 0x01] and len(atr) >= 15:
        code = (atr[13] << 8) | atr[14]
        name = ACS_TYPES.get(code)
        base = "синтетический ATR ACS: бесконтактная карта как T=1"
        return base + (", тип: " + name if name else "")
    if atr[0] == 0x3B:
        return "прямая конвенция — похоже на контактную карту (ICC-слот)"
    if atr[0] == 0x3F:
        return "обратная конвенция (встречается редко)"
    return ""


class Gui:
    def __init__(self, root):
        self.root = root
        self.q = queue.Queue()
        self.busy = False
        self.report = {}
        self.memory = {}
        self.memory_title = ""
        self.errors = []

        root.title("ACR1281U — чтение карты")
        root.geometry("1080x660")
        root.minsize(880, 540)

        self.style = ttk.Style()
        self.style.configure("TButton", padding=5, font=("Segoe UI", 10))
        self.style.configure("Scan.TButton", font=("Segoe UI", 10, "bold"))
        self.style.configure("Treeview", font=("Consolas", 10), rowheight=26)
        self.style.configure("Treeview.Heading", font=("Segoe UI", 9, "bold"))
        self.style.configure("Accent.Horizontal.TProgressbar",
                             troughcolor="#e3ded2", background=ACCENT,
                             bordercolor=ACCENT, lightcolor=ACCENT,
                             darkcolor=ACCENT)

        self._build_toolbar()
        self._build_tabs()
        self._build_statusbar()

        self.refresh_readers()
        self.root.after(90, self._pump)

    # ------------------------------------------------------------ интерфейс
    def _build_toolbar(self):
        bar = ttk.Frame(self.root, padding=(10, 8))
        bar.pack(fill="x")

        ttk.Label(bar, text="Ридер:").pack(side="left")
        self.reader_var = tk.StringVar()
        self.combo = ttk.Combobox(bar, textvariable=self.reader_var,
                                  state="readonly", width=42)
        self.combo.pack(side="left", padx=(6, 4))

        ttk.Button(bar, text="Обновить", width=9,
                   command=self.refresh_readers).pack(side="left")

        self.scan_btn = ttk.Button(bar, text="  Сканировать карту  ",
                                   style="Scan.TButton", command=self.scan)
        self.scan_btn.pack(side="left", padx=(14, 4))

        self.save_btn = ttk.Button(bar, text="Сохранить отчёт…",
                                   command=self.save, state="disabled")
        self.save_btn.pack(side="left")

        ttk.Button(bar, text="Очистить", width=9,
                   command=self.clear).pack(side="right")

    def _build_tabs(self):
        self.nb = ttk.Notebook(self.root)
        self.nb.pack(fill="both", expand=True, padx=10, pady=(0, 6))

        # -- параметры
        f_params = ttk.Frame(self.nb)
        cols = ("param", "value")
        self.params = ttk.Treeview(f_params, columns=cols, show="headings")
        self.params.heading("param", text="Параметр")
        self.params.heading("value", text="Значение")
        self.params.column("param", width=260, stretch=False)
        self.params.column("value", width=640)
        sb = ttk.Scrollbar(f_params, orient="vertical",
                           command=self.params.yview)
        self.params.configure(yscrollcommand=sb.set)
        self.params.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")
        self.nb.add(f_params, text="  Параметры  ")

        # -- память
        f_mem = ttk.Frame(self.nb)
        mcols = ("addr", "data")
        self.mem = ttk.Treeview(f_mem, columns=mcols, show="headings")
        self.mem.heading("addr", text="Блок / страницы")
        self.mem.heading("data", text="Данные (hex)")
        self.mem.column("addr", width=150, stretch=False)
        self.mem.column("data", width=700)
        sbm = ttk.Scrollbar(f_mem, orient="vertical", command=self.mem.yview)
        self.mem.configure(yscrollcommand=sbm.set)
        self.mem.pack(side="left", fill="both", expand=True)
        sbm.pack(side="right", fill="y")
        self.nb.add(f_mem, text="  Память  ")

        # -- журнал
        f_log = ttk.Frame(self.nb)
        self.log = tk.Text(f_log, wrap="word", state="disabled",
                           font=("Consolas", 10), bg="#fbfaf6",
                           relief="flat", padx=8, pady=6)
        self.log.tag_configure("ok", foreground=C_OK)
        self.log.tag_configure("warn", foreground=C_WARN)
        self.log.tag_configure("err", foreground=C_ERR)
        self.log.tag_configure("info", foreground="#33475a")
        self.log.tag_configure("time", foreground="#9aa7b1")
        slb = ttk.Scrollbar(f_log, orient="vertical", command=self.log.yview)
        self.log.configure(yscrollcommand=slb.set)
        self.log.pack(side="left", fill="both", expand=True)
        slb.pack(side="right", fill="y")
        self.nb.add(f_log, text="  Журнал  ")

    def _build_statusbar(self):
        bar = ttk.Frame(self.root, padding=(10, 6))
        bar.pack(fill="x", side="bottom")

        self.led = tk.Canvas(bar, width=14, height=14, highlightthickness=0)
        self.led.pack(side="left")
        self.led_id = self.led.create_oval(2, 2, 12, 12, fill="#b8c1c8",
                                           outline="")

        self.status_var = tk.StringVar(
            value="Готово. Выберите ридер и нажмите «Сканировать карту».")
        ttk.Label(bar, textvariable=self.status_var,
                  font=("Segoe UI", 9)).pack(side="left", padx=(8, 14))

        self.count_var = tk.StringVar(value="")
        ttk.Label(bar, textvariable=self.count_var,
                  font=("Consolas", 9)).pack(side="right")

        self.progress = ttk.Progressbar(bar, length=240, mode="determinate",
                                        style="Accent.Horizontal.TProgressbar")
        self.progress.pack(side="right", padx=(0, 10))

    # -------------------------------------------------------------- команды
    def refresh_readers(self):
        names = [str(r) for r in readers()]
        self.combo["values"] = names
        if names:
            self.combo.current(0)
            self._log("info", "Найдено ридеров: %d" % len(names))
        else:
            self.status_var.set(
                "Ридеры не найдены. Проверьте драйвер ACS CCID и службу SCardSvr.")

    def clear(self):
        for w in (self.params, self.mem):
            for iid in w.get_children():
                w.delete(iid)
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")
        self.progress["value"] = 0
        self.report, self.memory, self.errors = {}, {}, []
        self.memory_title = ""
        self.count_var.set("")
        self.save_btn.configure(state="disabled")
        self._led("idle")
        self.status_var.set("Очищено.")

    def scan(self):
        if self.busy:
            return
        name = self.reader_var.get()
        if not name:
            messagebox.showwarning("ACR1281U", "Ридер не выбран.")
            return
        self.clear()
        self.busy = True
        self.scan_btn.configure(state="disabled")
        self.status_var.set("Чтение карты…")
        self._led("busy")
        threading.Thread(target=self._worker, args=(name,),
                         daemon=True).start()

    # --------------------------------------------------------------- worker
    def _worker(self, reader_name):
        send = self.q.put
        conn = None
        try:
            found = [r for r in readers() if str(r) == reader_name]
            if not found:
                send(("log", "err", "Ридер исчез из системы — нажмите «Обновить»."))
                return
            reader = found[0]
            send(("status", "Подключение: %s…" % reader_name))
            conn = reader.createConnection()
            conn.connect(CardConnection.T0_protocol | CardConnection.T1_protocol)
            send(("log", "ok", "Подключено: " + reader_name))

            self.report = {}
            self.memory = {}
            self.errors = []
            self.memory_title = ""

            def add(key, value):
                self.report[key] = value
                send(("param", key, value))

            def tx(apdu):
                try:
                    data, sw1, sw2 = conn.transmit(list(apdu))
                    return data, (sw1 << 8) | sw2
                except SmartcardException as exc:
                    self.errors.append("APDU %s -> %s" % (core.hx(apdu), exc))
                    send(("log", "err", "Сбой обмена APDU: %s" % exc))
                    return [], 0x6F00

            proto = {0: "direct", 1: "T=0", 2: "T=1",
                     3: "T=0+T=1"}.get(conn.getProtocol(), "?")
            add("Ридер", str(reader))
            add("Интерфейс", core.interface_of(reader))
            add("Протокол", proto)
            add("Python", sys.version.split()[0])
            try:
                atr = conn.getATR()
                add("ATR", core.hx(atr))
                note = atr_note(atr)
                if note:
                    add("ATR — заметка", note)
                    send(("log", "info", "ATR: " + note))
            except SmartcardException as exc:
                add("ATR", "-")
                self.errors.append("getATR: %s" % exc)

            contact = "ICC" in str(reader).upper()
            sak = self._poll(tx, add, send)

            if sak in (0x08, 0x09, 0x18):
                send(("status", "Чтение секторов Mifare…"))
                self._mifare(tx, sak, add, send)
                self.memory_title = "ПАМЯТЬ - БЛОКИ MIFARE (hex)"
            elif sak == 0x00:
                send(("status", "Чтение страниц NTAG / Ultralight…"))
                self._ntag(tx, add, send)
                self.memory_title = "ПАМЯТЬ - СТРАНИЦЫ NTAG / ULTRALIGHT (hex)"
            elif contact or sak in (0x20, 0x28):
                send(("status", "Поиск EMV-приложений (PPSE)…"))
                self._emv(tx, add, send)

            if self.errors:
                add("Ошибок при чтении", str(len(self.errors)))
            send(("log", "ok",
                  "Готово. Параметров: %d, строк памяти: %d, ошибок: %d"
                  % (len(self.report), len(self.memory), len(self.errors))))
        except NoCardException:
            send(("log", "err", "Карта не обнаружена — положите её на ридер."))
        except CardConnectionException as exc:
            send(("log", "err", "Ошибка соединения: %s" % exc))
        except SmartcardException as exc:
            send(("log", "err", "Ошибка PC/SC: %s" % exc))
        finally:
            if conn is not None:
                try:
                    conn.disconnect()
                except SmartcardException:
                    pass
            send(("done",))

    def _poll(self, tx, add, send):
        uid, sw = tx(core.GET_UID)
        if sw == 0x9000 and uid:
            add("UID", core.hx(uid))
            add("Длина UID", "%d байт" % len(uid))
            send(("log", "info", "UID: " + core.hx(uid)))

        sak = None
        data, sw = tx(core.PICC_POLL)
        if sw == 0x9000 and len(data) >= 7 and data[0] == 0xD5 and data[2] > 0:
            sens, sak = data[3:5], data[5]
            nlen = data[6]
            add("ATQA (SENS_RES)", core.hx(sens))
            add("SAK (SEL_RES)", "%02X" % sak)
            add("Тип карты", core.SAK_TYPES.get(sak,
                                                "неизвестен (SAK=%02X)" % sak))
            if nlen:
                add("NFCID", core.hx(data[7:7 + nlen]))
            send(("log", "ok", "Тип карты: " +
                  core.SAK_TYPES.get(sak, "SAK=%02X" % sak)))
        else:
            add("ATQA (SENS_RES)", "-")
            add("SAK (SEL_RES)", "-")
            add("Тип карты", "не ISO 14443 (вероятно, контактная)")

        data, sw = tx(core.PICC_STATUS)
        if sw == 0x9000 and len(data) >= 5:
            modes = {0x00: "авто", 0x01: "106 кбит/с", 0x02: "212 кбит/с",
                     0x04: "424 кбит/с", 0x08: "848 кбит/с"}
            add("Режим PICC", modes.get(data[2], "%02X" % data[2]))

        if sak in (0x20, 0x28):
            ats, sw = tx(core.GET_ATS)
            if sw == 0x9000 and ats:
                add("ATS", core.hx(ats))
        return sak

    def _mifare(self, tx, sak, add, send):
        sectors = {0x18: 40, 0x09: 5}.get(sak, 16)
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
            else:
                for i in range(count):
                    data, sw = tx(core.READ_BLOCK(first + i))
                    if sw == 0x9000:
                        name = "Блок %03d" % (first + i)
                        self.memory[name] = core.hx(data)
                        send(("mem", name, core.hx(data)))
                        read_ok += 1
            send(("progress", (sec + 1) / float(sectors)))
            send(("count", "Сектора %d/%d · Блоки %d/%d"
                  % (sec + 1, sectors, read_ok, total)))
        add("Прочитано блоков", "%d / %d" % (read_ok, total))
        add("Секторов с ключом", "%d / %d" % (keys_ok, sectors))

    def _ntag(self, tx, add, send):
        got = 0
        for n, start in enumerate((0x00, 0x04, 0x08, 0x0C)):
            data, sw = tx(core.READ_BLOCK(start))
            if sw == 0x9000:
                name = "Стр. %02X-%02X" % (start, start + 3)
                self.memory[name] = core.hx(data)
                send(("mem", name, core.hx(data)))
                got += 1
            send(("progress", (n + 1) / 4.0))
        if got:
            add("Страниц прочитано", "%d по 4 (00-0F), 16 байт" % got)

    def _emv(self, tx, add, send):
        ppse = [0x00, 0xA4, 0x04, 0x00, 0x0E] + list(b"1PAY.SYS.DDF01")
        if tx(ppse)[1] != 0x9000:
            send(("log", "warn",
                  "PPSE недоступен — карта не EMV или не отвечает на SELECT."))
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
                    add("Приложение %d (AID)" % n,
                        core.hx(data[i + 2:i + 2 + ln]))
                    send(("log", "ok", "AID: " + core.hx(data[i + 2:i + 2 + ln])))
                    break
                i += 2 + ln
        if n == 0:
            send(("log", "warn", "Приложения в PPSE не найдены."))

    # ----------------------------------------------------------------- вывод
    def _pump(self):
        try:
            while True:
                ev = self.q.get_nowait()
                kind = ev[0]
                if kind == "log":
                    self._log(ev[1], ev[2])
                elif kind == "param":
                    self.params.insert("", "end", values=(ev[1], ev[2]))
                    self.params.yview_moveto(1)
                elif kind == "mem":
                    self.mem.insert("", "end", values=(ev[1], ev[2]))
                elif kind == "progress":
                    self.progress["value"] = ev[1] * 100
                elif kind == "count":
                    self.count_var.set(ev[1])
                elif kind == "status":
                    self.status_var.set(ev[1])
                elif kind == "done":
                    self.busy = False
                    self.scan_btn.configure(state="normal")
                    self.save_btn.configure(
                        state="normal" if self.report else "disabled")
                    self._led("ok" if self.report else "err")
                    if self.report:
                        self.status_var.set(
                            "Готово. «Сохранить отчёт…» — файлы .txt и .json.")
                    else:
                        self.status_var.set("Не удалось прочитать. Смотрите журнал.")
        except queue.Empty:
            pass
        self.root.after(90, self._pump)

    def _log(self, tag, text):
        stamp = datetime.now().strftime("%H:%M:%S")
        self.log.configure(state="normal")
        self.log.insert("end", stamp + "  ", "time")
        self.log.insert("end", text + "\n", tag)
        self.log.configure(state="disabled")
        self.log.see("end")

    def _led(self, state):
        color = {"busy": "#f2a51b", "ok": "#2ebd6b",
                 "err": "#e8501d"}.get(state, "#b8c1c8")
        self.led.itemconfigure(self.led_id, fill=color)

    def save(self):
        if not self.report:
            return
        uid = self.report.get("UID", "").replace(" ", "")[:14] or "CONTACT"
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        default = "card_report_%s_%s.txt" % (uid, stamp)
        path = filedialog.asksaveasfilename(
            defaultextension=".txt",
            filetypes=[("Отчёт карты", "*.txt"), ("Все файлы", "*.*")],
            initialfile=default)
        if not path:
            return
        core.ERRORS[:] = self.errors  # передаём ошибки в форматтер core
        txt = core.build_txt(self.report, self.memory, self.memory_title)
        with open(path, "w", encoding="utf-8") as f:
            f.write(txt)
        if path.lower().endswith(".txt"):
            json_path = path[:-4] + ".json"
        else:
            json_path = path + ".json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump({"report": self.report, "memory": self.memory,
                       "errors": self.errors}, f, ensure_ascii=False, indent=2)
        self._log("ok", "Сохранено: " + path)
        self._log("ok", "Сохранено: " + json_path)
        self.status_var.set("Отчёт сохранён: " + path)


def main():
    root = tk.Tk()
    Gui(root)
    root.mainloop()


if __name__ == "__main__":
    main()
