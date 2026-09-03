import { useMemo, useState } from "react";
import { PY_SOURCE, REQUIREMENTS_SOURCE, RUN_BAT_SOURCE } from "../data/sources";
import { downloadFile, highlightPython, useCopy } from "../lib/ui";

/* ============================================================
   Окно кода
   ============================================================ */

export function CodeWindow({
  filename,
  code,
  isPython = false,
  heightClass = "max-h-[560px]",
}: {
  filename: string;
  code: string;
  isPython?: boolean;
  heightClass?: string;
}) {
  const [copied, copy] = useCopy();
  const lines = useMemo(() => {
    const arr = code.replace(/\n$/, "").split("\n");
    return arr;
  }, [code]);
  const highlighted = useMemo(
    () => (isPython ? lines.map((l) => highlightPython(l + "\n")) : null),
    [isPython, lines],
  );

  return (
    <div className="frame-corners border-2 border-ink bg-night text-mist2 shadow-[8px_8px_0_0_rgba(13,27,38,0.14)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-ink bg-night2 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 bg-acc" aria-hidden />
          <span className="h-2.5 w-2.5 bg-amber" aria-hidden />
          <span className="h-2.5 w-2.5 bg-led" aria-hidden />
          <span className="ml-2 font-mono text-[12px] font-semibold text-mist2">{filename}</span>
          <span className="font-mono text-[11px] text-mist/60">{lines.length} стр.</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => copy(code)}
            className="cursor-pointer border border-mist/40 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-mist transition-colors hover:border-acc hover:text-acc"
          >
            {copied ? "✓ Скопировано" : "Копировать"}
          </button>
          <button
            type="button"
            onClick={() => downloadFile(filename, code)}
            className="cursor-pointer border border-mist/40 bg-mist/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-mist transition-colors hover:border-led hover:text-led"
          >
            ⬇ Скачать
          </button>
        </div>
      </div>
      <div className={`code-scroll overflow-auto ${heightClass} py-3 pr-4`}>
        <pre className="font-mono text-[12.5px] leading-[1.7]">
          {lines.map((line, i) => (
            <div key={i} className="flex min-w-max">
              <span className="w-11 shrink-0 select-none pr-4 text-right text-mist/30">{i + 1}</span>
              <span className="whitespace-pre">{highlighted ? highlighted[i] : line + "\n"}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

/* ============================================================
   Вкладки файлов
   ============================================================ */

const FILES = [
  { name: "acr1281_dump.py", code: PY_SOURCE, py: true, note: "основной скрипт" },
  { name: "requirements.txt", code: REQUIREMENTS_SOURCE, py: false, note: "зависимости" },
  { name: "run.bat", code: RUN_BAT_SOURCE, py: false, note: "запуск двойным кликом" },
];

export default function ProgramTabs() {
  const [active, setActive] = useState(0);
  const file = FILES[active];
  return (
    <div>
      <div className="flex flex-wrap gap-0 border-2 border-b-0 border-ink">
        {FILES.map((f, idx) => (
          <button
            key={f.name}
            type="button"
            onClick={() => setActive(idx)}
            className={`cursor-pointer border-r-2 border-ink px-4 py-2.5 text-left font-mono text-[12px] font-semibold transition-colors last:border-r-0 ${
              idx === active
                ? "bg-ink text-amber"
                : "bg-paper2 text-ink2 hover:bg-amber/30"
            }`}
          >
            {f.name}
            <span className={`ml-2 text-[10px] font-normal ${idx === active ? "text-mist" : "text-ink2/50"}`}>{f.note}</span>
          </button>
        ))}
      </div>
      <CodeWindow filename={file.name} code={file.code} isPython={file.py} />
    </div>
  );
}
