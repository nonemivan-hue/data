import { useEffect, useRef, useState } from "react";
import { LOG_LINES } from "../data/sources";
import { usePrefersReducedMotion } from "../lib/ui";

const TONE_CLASS: Record<string, string> = {
  ok: "text-led",
  info: "text-mist",
  warn: "text-amber",
  acc: "text-acc",
};

function Screws() {
  return (
    <>
      {["top-3 left-3", "top-3 right-3", "bottom-3 left-3", "bottom-3 right-3"].map((pos) => (
        <span key={pos} className={`pointer-events-none absolute ${pos} hidden h-3 w-3 rounded-full border border-mist/30 bg-night2 md:block`} aria-hidden>
          <span className="absolute left-1/2 top-1/2 h-[1.5px] w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-mist/40" />
        </span>
      ))}
    </>
  );
}

function Led({ color, label, fast = false, soft = false }: { color: string; label: string; fast?: boolean; soft?: boolean }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.18em] text-mist">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${soft ? "soft-pulse" : `led-blink${fast ? " fast" : ""}`}`}
        style={{ backgroundColor: color, color }}
      />
      {label}
    </span>
  );
}

/* -------- SVG карты -------- */
function CardArt() {
  return (
    <svg viewBox="0 0 430 290" className="w-full max-w-[460px]" role="img" aria-label="Бесконтактная карта на ридере ACR1281U">
      {/* waves from reader */}
      <g stroke="#2ebd6b" strokeWidth="2.4" fill="none" strokeLinecap="round">
        <path className="wave-pulse" d="M60 236a26 26 0 0 1 0-52" style={{ transformOrigin: "60px 210px" }} />
        <path className="wave-pulse w2" d="M74 248a44 44 0 0 1 0-76" style={{ transformOrigin: "74px 210px" }} />
        <path className="wave-pulse w3" d="M88 260a62 62 0 0 1 0-100" style={{ transformOrigin: "88px 210px" }} />
      </g>
      {/* reader slab */}
      <g>
        <rect x="18" y="196" width="150" height="30" rx="6" fill="#122536" stroke="#33506a" strokeWidth="1.6" />
        <circle cx="40" cy="211" r="4" fill="#f2a51b" />
        <text x="56" y="215" fill="#9fb3c0" fontSize="11" fontFamily="IBM Plex Mono, monospace">ACR1281U-C1</text>
      </g>
      {/* card */}
      <g transform="rotate(-6 250 120)">
        <rect x="118" y="34" width="292" height="184" rx="16" fill="#16293a" stroke="#9fb3c0" strokeWidth="2" />
        <rect x="118" y="34" width="292" height="184" rx="16" fill="url(#cardShine)" />
        {/* contact chip */}
        <g fill="#f0561c">
          <rect x="150" y="86" width="54" height="44" rx="6" />
        </g>
        <g stroke="#0d1b26" strokeWidth="2">
          <path d="M150 100h54M150 116h54M168 86v44M186 86v44" />
        </g>
        {/* contactless antenna */}
        <g stroke="#2ebd6b" strokeWidth="2.6" fill="none" strokeLinecap="round">
          <path d="M352 88a34 34 0 0 1 0 64" />
          <path d="M338 96a22 22 0 0 1 0 48" opacity="0.8" />
          <path d="M324 104a12 12 0 0 1 0 32" opacity="0.6" />
        </g>
        {/* print */}
        <text x="150" y="70" fill="#d7e3ea" fontSize="15" fontWeight="700" fontFamily="Russo One, sans-serif" letterSpacing="2">MIFARE CLASSIC 1K</text>
        <text x="150" y="166" fill="#9fb3c0" fontSize="12" fontFamily="IBM Plex Mono, monospace">UID 04:A1:2B:32:4C:58:80</text>
        <text x="150" y="188" fill="#5d7a8f" fontSize="11" fontFamily="IBM Plex Mono, monospace">ATQA 00 04 · SAK 08 · 13.56 MHz</text>
        <rect x="230" y="156" width="86" height="34" rx="4" fill="none" stroke="#33506a" strokeWidth="1.4" strokeDasharray="5 4" />
        <text x="240" y="177" fill="#5d7a8f" fontSize="11" fontFamily="IBM Plex Mono, monospace">SECTOR 00</text>
      </g>
      <defs>
        <linearGradient id="cardShine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.16" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* -------- терминал -------- */
function ScanTerminal() {
  const reduced = usePrefersReducedMotion();
  const [count, setCount] = useState(reduced ? LOG_LINES.length : 0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) {
      setCount(LOG_LINES.length);
      return;
    }
    let step = 0;
    setCount(0);
    const tick = () => {
      step += 1;
      if (step > LOG_LINES.length + 6) step = 0;
      setCount(Math.min(step, LOG_LINES.length));
    };
    timer.current = window.setInterval(tick, 640);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [reduced]);

  const progress = Math.round((count / LOG_LINES.length) * 100);
  const cells = 26;
  const filled = Math.round((count / LOG_LINES.length) * cells);

  return (
    <div className="flex h-full flex-col border border-mist/25 bg-night2/80">
      {/* title bar */}
      <div className="flex items-center justify-between border-b border-mist/20 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 bg-acc" />
          <span className="h-2.5 w-2.5 bg-amber" />
          <span className="h-2.5 w-2.5 bg-led" />
        </div>
        <span className="font-mono text-[11px] tracking-[0.14em] text-mist">acr1281_dump.py · сеанс чтения</span>
        <span className="font-mono text-[11px] text-led">● REC</span>
      </div>
      {/* log */}
      <div className="code-scroll min-h-[260px] flex-1 overflow-hidden px-4 py-3 font-mono text-[12.5px] leading-[1.85]">
        {LOG_LINES.slice(0, count).map((l, idx) => (
          <div key={idx} className="flex gap-3 whitespace-nowrap">
            <span className="text-mist/50">[{l.t}]</span>
            <span className={TONE_CLASS[l.tone]}>{l.text}</span>
          </div>
        ))}
        <div className="text-mist">
          <span className="text-acc">▸</span> <span className="caret-blink inline-block h-[15px] w-[8px] translate-y-[3px] bg-led" />
        </div>
      </div>
      {/* progress */}
      <div className="border-t border-mist/20 px-4 py-3">
        <div className="mb-1.5 flex justify-between font-mono text-[10px] tracking-[0.2em] text-mist">
          <span>SECTOR SCAN</span>
          <span className="text-amber">{progress}%</span>
        </div>
        <div className="font-mono text-[12px] leading-none tracking-[-0.06em]" aria-hidden>
          <span className="text-acc">{"█".repeat(filled)}</span>
          <span className="text-mist/25">{"░".repeat(cells - filled)}</span>
        </div>
      </div>
    </div>
  );
}

/* -------- панель -------- */
export default function ScannerPanel() {
  return (
    <section id="top" className="panel-grid relative overflow-hidden bg-night text-mist2">
      <Screws />
      {/* верхняя приборная полоса */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 pt-6 md:px-8">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center border-2 border-acc text-acc">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5">
              <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
              <rect x="6" y="9.5" width="4.5" height="4" rx="0.8" fill="currentColor" stroke="none" />
              <path d="M14.5 9a4 4 0 0 1 0 6M17 7.5a7 7 0 0 1 0 9" strokeLinecap="round" />
            </svg>
          </span>
          <span className="font-mono text-[12px] font-semibold tracking-[0.22em] text-mist2">
            ACR1281U <span className="text-acc">/</span> CARD DUMP
          </span>
        </div>
        <div className="flex items-center gap-5">
          <Led color="#2ebd6b" label="PWR" />
          <Led color="#f2a51b" label="RF 13.56" soft />
          <Led color="#f0561c" label="ACT" fast />
        </div>
      </div>

      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pb-14 pt-10 md:px-8 lg:grid-cols-[1.08fr_1fr] lg:gap-14 lg:pt-14">
        {/* левая колонка */}
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.26em] text-amber">
            Windows · Python · pyscard · PC/SC
          </p>
          <h1 className="mt-4 font-display uppercase leading-[1.02] text-mist2">
            <span className="mask-line on text-[clamp(2.1rem,5.4vw,4rem)]">
              <span>Карта →</span>
            </span>
            <span className="mask-line on text-[clamp(2.1rem,5.4vw,4rem)]">
              <span className="text-acc">файл параметров</span>
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-mist">
            Готовая программа для <b className="text-mist2">ACR1281U</b>: кладёте карту — скрипт опрашивает её по PC/SC,
            собирает <b className="text-mist2">UID, ATR, ATQA, SAK, сектора памяти</b> и сохраняет отчёт файлом
            <span className="mx-1 border border-mist/30 bg-night2 px-1.5 py-0.5 font-mono text-[12px] text-amber">параметр : значение</span>
            плюс JSON-копию. Ниже — сам скрипт, разбор ATR и всё, что нужно для запуска.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <a href="#program" className="btn-hard inline-flex items-center gap-2 border-2 border-acc bg-acc px-5 py-3 font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-ink hover:bg-amber">
              Скачать acr1281_dump.py
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-4 w-4">
                <path d="M12 3v12m0 0 4.5-4.5M12 15 7.5 10.5M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <a href="#atr" className="btn-hard inline-flex items-center gap-2 border-2 border-mist/40 bg-transparent px-5 py-3 font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-mist2 hover:border-acc hover:text-acc">
              Разбор ATR
            </a>
          </div>

          <dl className="mt-9 grid max-w-xl grid-cols-3 gap-px border border-mist/20 bg-mist/20 font-mono">
            {[
              ["13.56 МГц", "рабочая частота"],
              ["6+", "типов карт"],
              ["2 файла", "txt + json"],
            ].map(([v, k]) => (
              <div key={k} className="bg-night px-3 py-3 text-center">
                <dt className="text-[10px] uppercase tracking-[0.18em] text-mist/70">{k}</dt>
                <dd className="mt-1 text-[15px] font-bold text-amber">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* правая колонка: карта + терминал */}
        <div className="flex flex-col gap-5">
          <div className="group relative overflow-hidden border border-mist/25 bg-night2/60 p-4 transition-transform duration-500 hover:-rotate-1 hover:scale-[1.015]">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[14%] overflow-visible">
              <div className="scan-beam h-full w-full bg-gradient-to-r from-transparent via-led/25 to-transparent">
                <div className="absolute right-0 top-0 h-full w-[2px] bg-led shadow-[0_0_14px_2px_rgba(46,189,107,0.8)]" />
              </div>
            </div>
            <CardArt />
            <div className="flex items-center justify-between border-t border-mist/20 px-1 pt-2.5 font-mono text-[10px] tracking-[0.2em] text-mist/70">
              <span>FIELD: ON</span>
              <span>TARGET: IN</span>
              <span className="text-led">LINK OK</span>
            </div>
          </div>
          <ScanTerminal />
        </div>
      </div>
    </section>
  );
}
