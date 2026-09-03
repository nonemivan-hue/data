import { useMemo, useState } from "react";
import { ATR_SAMPLES } from "../data/sources";
import { parseAtr, RowKind } from "../lib/atr";
import { StatusChip } from "../lib/ui";

const KIND_STYLE: Record<RowKind, string> = {
  ts: "border-acc/70 bg-acc/12 text-acc-deep",
  t0: "border-amber/80 bg-amber/15 text-[#8a5c05]",
  ic: "border-acc2/60 bg-acc2/10 text-acc2",
  hist: "border-led/60 bg-led/10 text-[#1e7a46]",
  tck: "border-ink/50 bg-ink/8 text-ink",
};

const KIND_LABEL: Record<RowKind, string> = {
  ts: "TS",
  t0: "T0",
  ic: "символ интерфейса",
  hist: "исторический",
  tck: "контрольный",
};

const TONE_CHIP: Record<string, "ok" | "warn" | "bad" | "acc" | "info"> = {
  ok: "ok",
  warn: "warn",
  bad: "bad",
  acc: "acc",
};

export default function AtrParser() {
  const [value, setValue] = useState(ATR_SAMPLES[0].hex);
  const result = useMemo(() => parseAtr(value), [value]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.25fr]">
      {/* левая колонка: ввод + параметры */}
      <div className="flex flex-col gap-6">
        <div className="frame-corners border-2 border-ink bg-night p-5 text-mist2 shadow-[8px_8px_0_0_rgba(13,27,38,0.14)]">
          <div className="mb-3 flex items-center justify-between">
            <label htmlFor="atr-input" className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-amber">
              ATR (hex)
            </label>
            <span className="font-mono text-[11px] text-mist/60">
              {value.replace(/[^0-9a-fA-F]/g, "").length / 2 | 0} байт
            </span>
          </div>
          <textarea
            id="atr-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
            rows={3}
            className="code-scroll w-full resize-y border border-mist/30 bg-night2 px-3 py-2.5 font-mono text-[13px] leading-relaxed text-led outline-none placeholder:text-mist/40 focus:border-acc"
            placeholder="3B 8F 80 01 80 4F 0C A0 …"
          />
          <div className="mt-4">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mist/70">Образцы — кликните:</p>
            <div className="flex flex-wrap gap-2">
              {ATR_SAMPLES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setValue(s.hex)}
                  className={`cursor-pointer border px-2.5 py-1.5 font-mono text-[11px] transition-all hover:-translate-y-0.5 ${
                    value === s.hex
                      ? "border-acc bg-acc text-ink"
                      : "border-mist/35 text-mist hover:border-amber hover:text-amber"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* параметры */}
        <div className="border-2 border-ink bg-paper shadow-[8px_8px_0_0_rgba(13,27,38,0.1)]">
          <div className="flex items-center justify-between border-b-2 border-ink bg-paper2 px-4 py-2.5">
            <span className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-ink">Извлечённые параметры</span>
            {result.ok ? <StatusChip tone="ok">РАЗБОР OK</StatusChip> : <StatusChip tone="bad">ОШИБКА</StatusChip>}
          </div>
          {!result.ok && (
            <div className="border-b-2 border-acc/40 bg-acc/8 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-acc-deep">
              ⚠ {result.error}
            </div>
          )}
          <dl className="divide-y divide-line">
            {result.params.length === 0 && result.ok === false && (
              <div className="px-4 py-3 font-mono text-[12.5px] text-ink2/60">Вставьте ATR — параметры появятся здесь.</div>
            )}
            {result.params.map((p, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 px-4 py-2.5 transition-colors hover:bg-amber/10">
                <dt className="font-mono text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink2/70">{p.label}</dt>
                <dd className="text-right font-mono text-[12.5px] font-medium text-ink">
                  {p.value}
                  {p.tone && (
                    <span className="ml-2 inline-block align-middle">
                      <StatusChip tone={TONE_CHIP[p.tone] ?? "info"}>{p.tone === "ok" ? "✓" : p.tone === "bad" ? "!" : "•"}</StatusChip>
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {result.notes.length > 0 && (
          <div className="border-l-4 border-acc bg-night2/90 p-4">
            {result.notes.map((n, i) => (
              <p key={i} className="font-mono text-[12px] leading-relaxed text-mist">
                <span className="mr-2 text-acc">▸</span>
                {n}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* правая колонка: побайтовая таблица */}
      <div className="border-2 border-ink bg-paper shadow-[8px_8px_0_0_rgba(13,27,38,0.1)]">
        <div className="border-b-2 border-ink bg-paper2 px-4 py-2.5">
          <span className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-ink">
            Побайтовый разбор <span className="ml-1 text-ink2/50">· ISO 7816-3</span>
          </span>
        </div>
        {result.rows.length === 0 ? (
          <div className="grid h-64 place-items-center px-6 text-center font-mono text-[13px] text-ink2/50">
            — нет данных: введите ATR слева —
          </div>
        ) : (
          <div className="code-scroll max-h-[640px] overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-ink bg-ink font-mono text-[10.5px] uppercase tracking-[0.16em] text-paper">
                  <th className="px-3 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">Символ</th>
                  <th className="px-3 py-2 font-semibold">Hex</th>
                  <th className="px-3 py-2 font-semibold">Значение</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[12.5px]">
                {result.rows.map((r) => (
                  <tr key={r.idx} className="border-b border-line align-top transition-colors hover:bg-amber/10">
                    <td className="px-3 py-2 text-ink2/45">{r.idx}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex flex-col border px-2 py-0.5 ${KIND_STYLE[r.kind]}`}>
                        <b className="text-[12.5px] leading-tight">{r.name}</b>
                        <i className="text-[9.5px] not-italic opacity-75">{KIND_LABEL[r.kind]}</i>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[13.5px] font-bold text-ink">{r.hex}</td>
                    <td className="px-3 py-2 leading-relaxed text-ink2">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t-2 border-ink bg-night px-4 py-2.5 font-mono text-[11px] text-mist">
          Легенда:{" "}
          <span className="text-acc">TS</span> · <span className="text-amber">T0</span> ·{" "}
          <span className="text-[#3aa79b]">TA/TB/TC/TD</span> · <span className="text-led">H1…Hn</span> ·{" "}
          <span className="text-mist2">TCK</span>
          <span className="float-right text-mist/60">f = 3.579545 МГц</span>
        </div>
      </div>
    </div>
  );
}
