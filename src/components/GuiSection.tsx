import { useEffect, useState } from "react";
import GUI_PY from "../../acr1281_gui.py?raw";
import { PY_SOURCE } from "../data/sources";
import { downloadFile, HardButton, SectionHead, usePrefersReducedMotion, useReveal } from "../lib/ui";

/* сценарий «живого» окна: шаг → строка параметров + строка журнала */
interface Step {
  param?: [string, string];
  log?: { tone: "ok" | "warn" | "err" | "info"; text: string };
  count?: string;
  status?: string;
}

const STEPS: Step[] = [
  { log: { tone: "info", text: "Найдено ридеров: 2" }, status: "Готово." },
  { log: { tone: "ok", text: "Подключено: ACS ACR1281 2S CL Reader PICC 0" }, param: ["Ридер", "ACS ACR1281 2S CL Reader PICC 0"], status: "Чтение карты…" },
  { param: ["Интерфейс", "PICC — бесконтактный (RF 13.56 МГц)"] },
  { param: ["Протокол", "T=1"] },
  { param: ["ATR", "3B 8F 80 01 80 4F 0C A0 00 00 03 06 … 6A"], log: { tone: "info", text: "ATR: синтетический ATR ACS, тип: Mifare Classic 1K" } },
  { param: ["UID", "04 A1 2B 32 4C 58 80"], log: { tone: "info", text: "UID: 04 A1 2B 32 4C 58 80" } },
  { param: ["ATQA (SENS_RES)", "00 04"] },
  { param: ["SAK (SEL_RES)", "08"] },
  { param: ["Тип карты", "Mifare Classic 1K"], log: { tone: "ok", text: "Тип карты: Mifare Classic 1K" }, status: "Чтение секторов Mifare…" },
  { param: ["Режим PICC", "106 кбит/с"] },
  { log: { tone: "ok", text: "Сектор 00 · ключ FF FF FF FF FF FF" }, count: "Сектора 1/16 · Блоки 4/64" },
  { log: { tone: "ok", text: "Сектор 01 · ключ FF FF FF FF FF FF" }, count: "Сектора 2/16 · Блоки 8/64" },
  { log: { tone: "warn", text: "Сектор 02 · ключ не подошёл" }, count: "Сектора 3/16 · Блоки 8/64" },
  { param: ["Прочитано блоков", "52 / 64"], count: "Сектора 16/16 · Блоки 52/64" },
  { param: ["Секторов с ключом", "13 / 16"] },
  { log: { tone: "ok", text: "Готово. Параметров: 12, строк памяти: 52, ошибок: 0" }, status: "Готово. «Сохранить отчёт…» — файлы .txt и .json." },
];

const TONE_COLOR: Record<string, string> = {
  ok: "text-led",
  warn: "text-amber",
  err: "text-acc",
  info: "text-mist",
};

const FEATURES = [
  {
    title: "Выбор ридера и интерфейса",
    text: "Выпадающий список PICC/ICC-устройств, кнопка «Обновить» — как в консоли, но без ручного редактирования кода.",
  },
  {
    title: "Сканирование в фоновом потоке",
    text: "Карта читается в отдельном потоке через очередь событий — окно не зависает, даже когда идёт перебор 16 секторов.",
  },
  {
    title: "Живая таблица «параметр : значение»",
    text: "Каждый параметр появляется в таблице в момент получения: UID, ATR, ATQA, SAK, тип карты, ATS…",
  },
  {
    title: "Журнал с цветом важности",
    text: "ok — зелёным, предупреждения — янтарным, сбои обмена APDU — красным, со временем каждого события.",
  },
  {
    title: "Сохранение одним диалогом",
    text: "«Сохранить отчёт…» кладёт рядом .txt и .json с именем по UID и дате — тот же формат, что у консольной версии.",
  },
];

function WindowMock() {
  const reduced = usePrefersReducedMotion();
  const total = STEPS.length;
  const [step, setStep] = useState(reduced ? total : 0);

  useEffect(() => {
    if (reduced) {
      setStep(total);
      return;
    }
    let s = 0;
    setStep(0);
    const id = window.setInterval(() => {
      s += 1;
      if (s > total + 5) s = 0;
      setStep(Math.min(s, total));
    }, 780);
    return () => window.clearInterval(id);
  }, [reduced, total]);

  const params = STEPS.slice(0, step).filter((s) => s.param).map((s) => s.param!);
  const logs = STEPS.slice(0, step).filter((s) => s.log).map((s) => s.log!);
  const lastCount = [...STEPS.slice(0, step)].reverse().find((s) => s.count)?.count ?? "";
  const status = [...STEPS.slice(0, step)].reverse().find((s) => s.status)?.status ?? "Готово.";
  const busy = step > 0 && step < total;
  const progress = Math.round((step / total) * 100);

  return (
    <div className="group border-2 border-ink bg-paper shadow-[12px_12px_0_0_rgba(13,27,38,0.16)] transition-transform duration-500 hover:-translate-y-1">
      {/* заголовок окна */}
      <div className="flex items-center justify-between border-b-2 border-ink bg-night px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-6 w-6 place-items-center border border-acc text-acc">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
              <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
              <rect x="6" y="9.5" width="4.5" height="4" rx="0.8" fill="currentColor" stroke="none" />
              <path d="M14.5 9a4 4 0 0 1 0 6" strokeLinecap="round" />
            </svg>
          </span>
          <span className="font-mono text-[12px] font-semibold text-mist2">ACR1281U — чтение карты</span>
          <span className="font-mono text-[10px] text-mist/50">python acr1281_gui.py</span>
        </div>
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="h-3 w-3 border border-mist/40" />
          <span className="h-3 w-3 border border-mist/40" />
          <span className="h-3 w-3 bg-acc" />
        </div>
      </div>

      {/* панель инструментов */}
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-ink bg-paper2 px-4 py-3">
        <span className="font-mono text-[11px] text-ink2">Ридер:</span>
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2 border-2 border-ink bg-paper px-3 py-1.5 font-mono text-[11.5px] text-ink">
          <span className="truncate">ACS ACR1281 2S CL Reader PICC 0</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-3 w-3 shrink-0 text-ink2">
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="border-2 border-ink bg-paper px-3 py-1.5 font-mono text-[11px] text-ink2">Обновить</span>
        <span
          className={`border-2 border-ink bg-acc px-4 py-1.5 font-mono text-[11.5px] font-bold text-ink ${busy ? "ring-pulse" : ""}`}
        >
          Сканировать карту
        </span>
        <span className="border-2 border-ink bg-paper px-3 py-1.5 font-mono text-[11px] text-ink2">Сохранить отчёт…</span>
      </div>

      {/* вкладки */}
      <div className="flex border-b-2 border-ink bg-paper2 font-mono text-[11.5px]">
        <span className="-mb-[2px] border-r-2 border-ink bg-paper px-4 py-2 font-bold text-ink">Параметры</span>
        <span className="border-r-2 border-ink px-4 py-2 text-ink2/60">Память</span>
        <span className="px-4 py-2 text-ink2/60">Журнал</span>
        <span className="ml-auto self-center pr-4 font-mono text-[10px] uppercase tracking-[0.18em] text-acc">
          live
        </span>
      </div>

      <div className="grid md:grid-cols-[1.35fr_1fr]">
        {/* таблица параметров */}
        <div className="min-h-[300px] border-r-2 border-ink bg-paper">
          <div className="grid grid-cols-[130px_1fr] border-b border-line bg-paper2 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ink2/70">
            <span>Параметр</span>
            <span>Значение</span>
          </div>
          <div className="max-h-[300px] overflow-hidden px-1 py-1">
            {params.map(([k, v], i) => (
              <div
                key={k}
                className="row-in grid grid-cols-[130px_1fr] items-baseline gap-2 px-2 py-[7px] font-mono text-[12px] transition-colors odd:bg-paper2/50 hover:bg-amber/15"
              >
                <span className="font-semibold text-ink2">{k}</span>
                <span className="truncate text-ink">{v}</span>
                {i === params.length - 1 && <span className="sr-only">новая строка</span>}
              </div>
            ))}
            {params.length === 0 && (
              <div className="px-3 py-6 font-mono text-[12px] text-ink2/50">— карта ещё не прочитана —</div>
            )}
          </div>
        </div>

        {/* журнал */}
        <div className="flex min-h-[300px] flex-col bg-night">
          <div className="flex-1 overflow-hidden px-3 py-2 font-mono text-[11.5px] leading-[1.8]">
            {logs.slice(-8).map((l, i) => (
              <div key={i} className="row-in flex gap-2 whitespace-nowrap">
                <span className="text-mist/40">21:07:{String(30 + i).padStart(2, "0")}</span>
                <span className={TONE_COLOR[l.tone]}>{l.text}</span>
              </div>
            ))}
            {logs.length === 0 && <div className="text-mist/40">журнал пуст…</div>}
          </div>
          {/* статус-бар */}
          <div className="border-t border-mist/20 px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-2 font-mono text-[10.5px] text-mist">
              <span
                className={`inline-block h-2 w-2 rounded-full ${busy ? "led-blink fast" : "soft-pulse"}`}
                style={{ backgroundColor: busy ? "#f2a51b" : "#2ebd6b", color: busy ? "#f2a51b" : "#2ebd6b" }}
              />
              <span className="truncate">{status}</span>
              <span className="ml-auto shrink-0 text-amber">{lastCount}</span>
            </div>
            <div className="h-2 w-full border border-mist/25 bg-night2">
              <div
                className="h-full bg-acc transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GuiSection() {
  const ref = useReveal<HTMLElement>();
  return (
    <section id="gui" ref={ref} className="scroll-mt-16 border-y-2 border-ink bg-paper2/70">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-24">
        <SectionHead
          num="04 / Графический интерфейс"
          title="Тот же скрипт — но с окном и кнопками"
          sub="acr1281_gui.py оборачивает логику v1.1 в окно tkinter: выбор ридера, сканирование, живая таблица параметров, журнал и сохранение отчёта. Консоль больше не нужна — а файлы результата те же: «параметр : значение» и JSON."
        />
        <div className="grid items-start gap-10 lg:grid-cols-[0.82fr_1.35fr]">
          <div className="flex flex-col gap-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="reveal group flex items-start gap-4 border-2 border-ink bg-paper p-4 shadow-[5px_5px_0_0_rgba(13,27,38,0.12)] transition-all duration-300 hover:-translate-y-0.5 hover:border-acc2 hover:shadow-[7px_7px_0_0_rgba(14,124,114,0.75)]"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <span className="mt-0.5 font-display text-[19px] leading-none text-acc2">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-display text-[14px] uppercase text-ink">{f.title}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink2/80">{f.text}</p>
                </div>
              </div>
            ))}

            <div className="reveal mt-2 border-2 border-ink bg-night p-4 font-mono text-[12.5px] leading-[1.9] text-mist">
              <p className="text-mist/60"># запуск GUI (обе .py — в одной папке)</p>
              <p>
                <span className="text-amber">C:\cards&gt;</span>{" "}
                <span className="text-mist2">python acr1281_gui.py</span>
              </p>
              <p className="text-mist/60"># консольная версия никуда не делась</p>
              <p>
                <span className="text-amber">C:\cards&gt;</span>{" "}
                <span className="text-mist2">python acr1281_dump.py</span>
              </p>
            </div>

            <div className="reveal flex flex-wrap gap-3">
              <HardButton variant="acc" onClick={() => downloadFile("acr1281_gui.py", GUI_PY)}>
                ⬇ acr1281_gui.py
              </HardButton>
              <HardButton variant="paper" onClick={() => downloadFile("acr1281_dump.py", PY_SOURCE)} title="основной скрипт v1.1">
                ⬇ acr1281_dump.py
              </HardButton>
            </div>
            <p className="reveal font-mono text-[11.5px] leading-relaxed text-ink2/70">
              tkinter входит в состав Python под Windows — из внешнего нужен только pyscard, уже установленный для консольной версии.
            </p>
          </div>
          <div className="reveal">
            <WindowMock />
            <p className="mt-3 font-mono text-[11.5px] text-ink2/60">
              ↑ так выглядит окно во время чтения Mifare Classic 1K: строки таблицы и журнала появляются по мере ответов карты.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
