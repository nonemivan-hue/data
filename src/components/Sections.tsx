import { useState } from "react";
import {
  CARD_ROWS,
  CMD_ROWS,
  FAQS,
  INSTALL_STEPS,
  SAMPLE_JSON,
  SAMPLE_TXT,
} from "../data/sources";
import { downloadFile, useCopy } from "../lib/ui";
import { CodeWindow } from "./CodeViewer";

/* ============================================================
   Бегущая строка стандартов
   ============================================================ */

const TICKER = [
  "ISO 14443-A",
  "ISO 14443-B",
  "ISO 7816 T=0 / T=1",
  "MIFARE CLASSIC",
  "NTAG",
  "FeliCa",
  "PC/SC 2.0",
  "CCID",
  "APDU",
  "FF CA 00 00 00",
  "13.56 МГц",
  "SAM ×2",
];

export function Ticker() {
  const row = [...TICKER, ...TICKER];
  return (
    <div className="overflow-hidden border-y-2 border-ink bg-acc" aria-hidden>
      <div className="ticker-track flex w-max items-center whitespace-nowrap py-2.5">
        {row.map((t, i) => (
          <span key={i} className="flex items-center font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-ink">
            <span className="px-5">{t}</span>
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-ink/70" fill="currentColor">
              <path d="M6 0l1.6 4.4L12 6 7.6 7.6 6 12 4.4 7.6 0 6l4.4-1.6z" />
            </svg>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   Образец отчёта
   ============================================================ */

export function ReportPreview() {
  const [tab, setTab] = useState<"txt" | "json">("txt");
  const [copied, copy] = useCopy();
  const fname = "card_report_04A12B324C5880_20260214_210733." + tab;
  const content = tab === "txt" ? SAMPLE_TXT : SAMPLE_JSON;

  return (
    <div>
      <div className="mb-0 flex flex-wrap items-center gap-0 border-2 border-b-0 border-ink">
        {(
          [
            ["txt", "отчёт .txt — «параметр : значение»"],
            ["json", "копия .json — для обработки"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`cursor-pointer border-r-2 border-ink px-4 py-2.5 font-mono text-[12px] font-semibold transition-colors ${
              tab === k ? "bg-ink text-amber" : "bg-paper2 text-ink2 hover:bg-amber/30"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto hidden items-center gap-2 px-4 md:flex">
          <button
            type="button"
            onClick={() => copy(content)}
            className="cursor-pointer border border-ink/40 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink2 hover:border-acc hover:text-acc"
          >
            {copied ? "✓ Скопировано" : "Копировать пример"}
          </button>
          <button
            type="button"
            onClick={() => downloadFile(fname, content)}
            className="cursor-pointer border border-ink/40 bg-ink px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-paper hover:bg-acc"
          >
            ⬇ Пример файла
          </button>
        </div>
      </div>
      <CodeWindow filename={fname} code={content} heightClass="max-h-[480px]" />
      <p className="mt-3 font-mono text-[12px] text-ink2/70">
        ↑ именно так выглядит результат: скрипт сам именует файл по UID и дате — <b>card_report_&lt;UID&gt;_&lt;ГГГГММДД_ЧЧММСС&gt;.txt</b>
      </p>
    </div>
  );
}

/* ============================================================
   Установка
   ============================================================ */

export function InstallSteps() {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const copyCmd = (code: string, idx: number) => {
    navigator.clipboard?.writeText(code).catch(() => undefined);
    setCopiedIdx(idx);
    window.setTimeout(() => setCopiedIdx((v) => (v === idx ? null : v)), 1500);
  };

  return (
    <ol className="relative grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {INSTALL_STEPS.map((s, i) => (
        <li
          key={s.title}
          className="reveal group relative border-2 border-ink bg-paper p-5 shadow-[6px_6px_0_0_rgba(13,27,38,0.12)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[9px_9px_0_0_rgba(240,86,28,0.9)]"
          style={{ transitionDelay: `${i * 60}ms` }}
        >
          <div className="flex items-start justify-between">
            <span className="font-display text-[2.6rem] leading-none text-acc">{String(i + 1).padStart(2, "0")}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-7 w-7 text-ink2/40 transition-colors group-hover:text-acc">
              {i === 0 && <path d="M12 3a7 7 0 0 1 7 7c0 2.4-1.2 3.9-2.4 5.2-.9 1-1.6 1.9-1.6 3.3H9c0-1.4-.7-2.3-1.6-3.3C6.2 13.9 5 12.4 5 10a7 7 0 0 1 7-7zM9 21h6" strokeLinecap="round" strokeLinejoin="round" />}
              {i === 1 && (<><rect x="3" y="5" width="18" height="13" rx="2" /><path d="M7 21h10M12 18v3M8.5 9.5l2 2-2 2M12.5 13.5h3" strokeLinecap="round" strokeLinejoin="round" /></>)}
              {i === 2 && (<><path d="M4 7h16v4H4zM4 13h16v4H4z" /><circle cx="7" cy="9" r="0.9" fill="currentColor" /><circle cx="7" cy="15" r="0.9" fill="currentColor" /></>)}
              {i === 3 && (<><path d="M6 2.5h8l4 4V21.5H6z" strokeLinejoin="round" /><path d="M14 2.5v4h4M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" /></>)}
              {i === 4 && (<><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><rect x="6" y="9.5" width="4.5" height="4" rx="0.8" fill="currentColor" stroke="none" /><path d="M14.5 9a4 4 0 0 1 0 6" strokeLinecap="round" /></>)}
            </svg>
          </div>
          <h3 className="mt-3 font-display text-[17px] uppercase text-ink">{s.title}</h3>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink2/85">{s.text}</p>
          {s.code && (
            <button
              type="button"
              onClick={() => copyCmd(s.code!, i)}
              className="mt-3 flex w-full cursor-pointer items-center justify-between gap-3 border border-ink/25 bg-night px-3 py-2 text-left font-mono text-[12px] text-led transition-colors hover:border-acc"
              title="Скопировать команду"
            >
              <span className="whitespace-pre-wrap">{s.code}</span>
              <span className={`shrink-0 text-[10px] uppercase tracking-widest ${copiedIdx === i ? "text-amber" : "text-mist/60"}`}>
                {copiedIdx === i ? "✓" : "copy"}
              </span>
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

/* ============================================================
   Таблицы: карты и APDU
   ============================================================ */

export function CardsTable() {
  return (
    <div className="frame-corners overflow-x-auto border-2 border-ink bg-paper shadow-[8px_8px_0_0_rgba(13,27,38,0.12)]">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-b-2 border-ink bg-ink font-mono text-[11px] uppercase tracking-[0.18em] text-paper">
            <th className="px-4 py-3 font-semibold">Стандарт</th>
            <th className="px-4 py-3 font-semibold">Карты</th>
            <th className="px-4 py-3 font-semibold">Что попадёт в отчёт</th>
          </tr>
        </thead>
        <tbody>
          {CARD_ROWS.map((r, i) => (
            <tr key={r.cards} className={`border-b border-line transition-colors hover:bg-amber/12 ${i % 2 ? "bg-paper2/60" : ""}`}>
              <td className="px-4 py-3.5">
                <span className="inline-block border border-acc2/60 bg-acc2/10 px-2 py-1 font-mono text-[11.5px] font-bold text-acc2">
                  {r.std}
                </span>
              </td>
              <td className="px-4 py-3.5 font-semibold text-ink">{r.cards}</td>
              <td className="px-4 py-3.5 text-[13.5px] leading-relaxed text-ink2/85">{r.reads}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CommandsTable() {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto border-2 border-ink bg-night text-mist2 shadow-[8px_8px_0_0_rgba(13,27,38,0.14)]">
      <table className="w-full min-w-[680px] border-collapse text-left">
        <thead>
          <tr className="border-b-2 border-mist/25 font-mono text-[11px] uppercase tracking-[0.18em] text-amber">
            <th className="px-4 py-3 font-semibold">APDU</th>
            <th className="px-4 py-3 font-semibold">Назначение</th>
            <th className="px-4 py-3 font-semibold">Что вернёт</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="font-mono text-[12.5px]">
          {CMD_ROWS.map((c) => (
            <tr key={c.apdu} className="border-b border-mist/12 transition-colors hover:bg-night2">
              <td className="px-4 py-3 font-semibold text-led">{c.apdu}</td>
              <td className="px-4 py-3 font-body text-[13px] text-mist2">{c.name}</td>
              <td className="px-4 py-3 font-body text-[13px] text-mist">{c.result}</td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(c.apdu).catch(() => undefined);
                    setCopied(c.apdu);
                    window.setTimeout(() => setCopied((v) => (v === c.apdu ? null : v)), 1200);
                  }}
                  className="cursor-pointer border border-mist/30 px-2 py-1 text-[10px] uppercase tracking-widest text-mist transition-colors hover:border-amber hover:text-amber"
                >
                  {copied === c.apdu ? "✓" : "копи"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================
   FAQ
   ============================================================ */

export function Faq() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {FAQS.map((f, i) => (
        <details
          key={f.q}
          className="faq-item reveal group border-2 border-ink bg-paper shadow-[5px_5px_0_0_rgba(13,27,38,0.12)] open:bg-night open:text-mist2"
          style={{ transitionDelay: `${(i % 2) * 70}ms` }}
        >
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 select-none">
            <span className="flex items-start gap-3">
              <span className="mt-0.5 font-mono text-[12px] font-bold text-acc">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-display text-[14.5px] uppercase leading-snug">{f.q}</span>
            </span>
            <span className="mt-1 shrink-0 text-acc transition-transform duration-300 group-open:rotate-45">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-5 w-5">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </span>
          </summary>
          <div className="border-t-2 border-dashed border-current/20 px-5 pb-5 pl-[52px] pt-4">
            <p className="text-[13.5px] leading-relaxed opacity-85">{f.a}</p>
            {f.code && (
              <pre className="code-scroll mt-3 overflow-x-auto border border-mist/25 bg-night2 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-led">
                {f.code}
              </pre>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

/* ============================================================
   Футер
   ============================================================ */

export function Footer() {
  return (
    <footer className="panel-grid border-t-2 border-ink bg-night text-mist">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 md:px-8 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center border-2 border-acc text-acc">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5">
                <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
                <rect x="6" y="9.5" width="4.5" height="4" rx="0.8" fill="currentColor" stroke="none" />
                <path d="M14.5 9a4 4 0 0 1 0 6M17 7.5a7 7 0 0 1 0 9" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <p className="font-display text-[16px] uppercase text-mist2">ACR1281U / Card Dump</p>
              <p className="font-mono text-[11px] tracking-[0.2em] text-mist/60">PYTHON · PYSCARD · PC/SC · WINDOWS</p>
            </div>
          </div>
          <p className="mt-5 max-w-xl border-l-2 border-amber pl-4 text-[13px] leading-relaxed text-mist/85">
            Инструмент предназначен для диагностики и инвентаризации <b className="text-amber">собственных</b> карт и карт,
            на чтение которых есть разрешение. Ключи секторов Mifare, не являющиеся заводскими, подбирайте только на картах,
            которыми владеете: чтение чужих карт может нарушать закон (ст. 272 УК РФ и аналоги).
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-x-6 gap-y-3 self-start font-mono text-[12.5px]">
          {[
            ["#program", "Программа"],
            ["#atr", "Разбор ATR"],
            ["#output", "Файл отчёта"],
            ["#install", "Установка"],
            ["#cards", "Карты и APDU"],
            ["#faq", "Вопросы"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="group flex items-center gap-2 text-mist transition-colors hover:text-amber">
              <span className="h-[2px] w-3 bg-acc transition-all group-hover:w-5 group-hover:bg-amber" />
              {label}
            </a>
          ))}
        </nav>
      </div>
      <div className="border-t border-mist/15">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-4 font-mono text-[11px] tracking-[0.14em] text-mist/50 md:px-8">
          <span>СХЕМА: КАРТА → PC/SC → APDU → ОТЧЁТ.TXT</span>
          <span>13.56 МГц · ISO 14443 · ISO 7816</span>
        </div>
      </div>
    </footer>
  );
}
