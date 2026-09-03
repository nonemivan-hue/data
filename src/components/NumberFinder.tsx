import { useMemo, useState } from "react";
import { SectionHead, usePrefersReducedMotion, useReveal } from "../lib/ui";

/* ============================================================
   Поиск номера в дампе карты: генерация кодировок + hex-сетка
   ============================================================ */

const DEFAULT_NEEDLE = "9643902303304575959";

const PALETTE = ["#f0561c", "#f2a51b", "#2ebd6b", "#22b8cf", "#e64980", "#9775fa"];

interface Candidate {
  name: string;
  desc: string;
  bytes: number[];
  color: string;
}
interface Match {
  cand: number;
  start: number;
}

const h2 = (b: number) => b.toString(16).toUpperCase().padStart(2, "0");

function withAlpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ---------- разбор дампа (hex-редактор / блоки из отчёта) ---------- */
function parseDump(input: string): number[] {
  const bytes: number[] = [];
  for (let raw of input.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    const off = line.match(/^[0-9a-fA-F]{4,8}\s{2,}(.*)$/);
    let body = off ? off[1] : line;
    body = body.replace(/\|[^|]*\|?$/, ""); // ascii-желоб |...|
    const hexChars = body.replace(/[^0-9a-fA-F]/g, "");
    for (let i = 0; i + 1 < hexChars.length; i += 2) {
      bytes.push(parseInt(hexChars.slice(i, i + 2), 16));
    }
  }
  return bytes;
}

/* ---------- кодировки номера ---------- */
function nibblesToBytes(nib: string): number[] {
  let s = nib.replace(/[^0-9a-fA-F]/g, "");
  if (s.length % 2 === 1) s += "0";
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
  return out;
}

function bigintToBytes(digits: string, little: boolean): number[] {
  try {
    let n = BigInt(digits);
    const out: number[] = [];
    while (n > 0n) {
      out.push(Number(n & 0xffn));
      n >>= 8n;
    }
    if (!out.length) out.push(0);
    return little ? out : out.reverse();
  } catch {
    return [];
  }
}

function buildCandidates(needle: string): Candidate[] {
  const cands: Candidate[] = [];
  let ci = 0;
  const color = () => PALETTE[ci++ % PALETTE.length];
  const digits = needle.replace(/\D/g, "");

  if (needle.trim()) {
    cands.push({
      name: "ASCII",
      desc: "каждая цифра — её ASCII-кодом (0x30–0x39)",
      bytes: [...needle].map((c) => c.charCodeAt(0) & 0xff),
      color: color(),
    });
    cands.push({
      name: "ASCII · реверс",
      desc: "строка задом наперёд",
      bytes: [...needle].reverse().map((c) => c.charCodeAt(0) & 0xff),
      color: color(),
    });
  }

  if (digits) {
    const evenLead = digits.length % 2 ? "0" + digits : digits;
    cands.push({
      name: "BCD · пад 0 слева",
      desc: "по 2 цифры в байт; нечёт — 0 в старшей ниббле",
      bytes: nibblesToBytes(evenLead),
      color: color(),
    });
    if (digits.length % 2) {
      cands.push({
        name: "BCD · пад F справа",
        desc: "нечёт — F в младшей ниббле последнего байта",
        bytes: nibblesToBytes(digits + "F"),
        color: color(),
      });
    }
    const rev = [...digits].reverse().join("");
    const revEven = rev.length % 2 ? "0" + rev : rev;
    cands.push({
      name: "BCD · реверс",
      desc: "цифры в обратном порядке, по 2 в байт",
      bytes: nibblesToBytes(revEven),
      color: color(),
    });
    cands.push({
      name: "Двоичный · BE",
      desc: "число целиком, старший байт первым",
      bytes: bigintToBytes(digits, false),
      color: color(),
    });
    cands.push({
      name: "Двоичный · LE",
      desc: "число целиком, младший байт первым",
      bytes: bigintToBytes(digits, true),
      color: color(),
    });
  }
  return cands;
}

function findMatches(dump: number[], cands: Candidate[]): Match[] {
  const matches: Match[] = [];
  cands.forEach((c, ci) => {
    const L = c.bytes.length;
    if (!L) return;
    for (let i = 0; i + L <= dump.length; i++) {
      let ok = true;
      for (let j = 0; j < L; j++)
        if (dump[i + j] !== c.bytes[j]) {
          ok = false;
          break;
        }
      if (ok) matches.push({ cand: ci, start: i });
    }
  });
  return matches;
}

/* ---------- детерминированный пример дампа ---------- */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function buildSampleDump(needle: string): string {
  const cands = buildCandidates(needle);
  const ascii = cands.find((c) => c.name === "ASCII")?.bytes ?? [];
  const bcd = cands.find((c) => c.name.startsWith("BCD"))?.bytes ?? [];
  const rnd = lcg(0xc0ffee);
  const total = 16 * 16;
  const arr: number[] = [];
  for (let i = 0; i < total; i++) arr.push(Math.floor(rnd() * 256));
  const put = (offset: number, bytes: number[]) => {
    for (let j = 0; j < bytes.length && offset + j < total; j++) arr[offset + j] = bytes[j];
  };
  put(0x20, ascii);
  put(0x90, bcd);
  const lines: string[] = [];
  for (let r = 0; r < total; r += 16) {
    const off = r.toString(16).toUpperCase().padStart(8, "0");
    lines.push(off + "  " + arr.slice(r, r + 16).map(h2).join(" "));
  }
  return lines.join("\n");
}

/* ---------- строка сигнатуры ---------- */
function SigRow({ cand, offsets }: { cand: Candidate; offsets: number[] }) {
  const [copied, setCopied] = useState(false);
  const hex = cand.bytes.map(h2).join(" ");
  const copy = () => {
    navigator.clipboard?.writeText(hex).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1300);
  };
  return (
    <div
      className="group border-l-[3px] bg-night2/70 px-3 py-2.5 transition-colors hover:bg-night2"
      style={{ borderColor: cand.color }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cand.color }} />
          <span className="truncate font-mono text-[12px] font-bold text-mist2">{cand.name}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-mist/50">{cand.bytes.length} Б</span>
        </div>
        <span
          className={`shrink-0 border px-2 py-0.5 font-mono text-[10.5px] font-bold ${
            offsets.length
              ? "border-led/50 text-led"
              : "border-mist/25 text-mist/40"
          }`}
        >
          {offsets.length ? `найдено ×${offsets.length}` : "нет"}
        </span>
      </div>
      <p className="mt-1 font-mono text-[10.5px] leading-relaxed text-mist/60">{cand.desc}</p>
      <div className="mt-1.5 flex items-start gap-2">
        <code
          className="min-w-0 flex-1 break-all font-mono text-[11.5px] leading-relaxed"
          style={{ color: cand.color }}
        >
          {hex || "—"}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 cursor-pointer border border-mist/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-mist transition-colors hover:border-amber hover:text-amber"
        >
          {copied ? "✓" : "копи"}
        </button>
      </div>
      {offsets.length > 0 && (
        <p className="mt-1 font-mono text-[10.5px] text-mist/70">
          смещения: {offsets.map((o) => "0x" + o.toString(16).toUpperCase().padStart(4, "0")).join(" · ")}
        </p>
      )}
    </div>
  );
}

/* ---------- hex-сетка ---------- */
const CAP = 2048;

function HexGrid({
  dump,
  cover,
  cands,
  reduced,
}: {
  dump: number[];
  cover: Map<number, number[]>;
  cands: Candidate[];
  reduced: boolean;
}) {
  const shown = dump.slice(0, CAP);
  const rows: number[][] = [];
  for (let i = 0; i < shown.length; i += 16) rows.push(shown.slice(i, i + 16));

  return (
    <div className="relative overflow-hidden border border-mist/25 bg-night">
      {!reduced && (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[10%]">
          <div className="scan-beam h-full w-full bg-gradient-to-r from-transparent via-acc/15 to-transparent">
            <div className="absolute right-0 top-0 h-full w-[2px] bg-acc/70 shadow-[0_0_12px_2px_rgba(240,86,28,0.5)]" />
          </div>
        </div>
      )}
      <div className="code-scroll max-h-[460px] overflow-auto p-3 font-mono text-[12px] leading-[1.9]">
        {rows.map((row, r) => {
          const base = r * 16;
          const ascii = row
            .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "·"))
            .join("");
          return (
            <div key={r} className="flex gap-3 whitespace-pre transition-colors hover:bg-night2/60">
              <span className="w-[72px] shrink-0 select-none text-right text-mist/35">
                {base.toString(16).toUpperCase().padStart(8, "0")}
              </span>
              <span className="min-w-0">
                {row.map((b, j) => {
                  const idx = base + j;
                  const hits = cover.get(idx);
                  const c = hits ? cands[hits[0]] : null;
                  return (
                    <span key={j}>
                      <span
                        className="px-[1px] transition-colors"
                        style={
                          c
                            ? {
                                background: withAlpha(c.color, 0.22),
                                color: c.color,
                                boxShadow: `inset 0 -2px 0 ${c.color}`,
                                fontWeight: 700,
                              }
                            : { color: "#d7e3ea" }
                        }
                      >
                        {h2(b)}
                      </span>
                      <span className="text-mist/30">{j === 7 ? "  " : " "}</span>
                    </span>
                  );
                })}
              </span>
              <span className="ml-auto hidden shrink-0 select-none text-mist/45 md:inline">{ascii}</span>
            </div>
          );
        })}
        {dump.length === 0 && (
          <div className="py-10 text-center text-mist/40">— вставьте дамп слева или загрузите пример —</div>
        )}
      </div>
      {dump.length > CAP && (
        <div className="border-t border-mist/20 px-3 py-1.5 font-mono text-[10.5px] text-amber">
          показано первые {CAP} из {dump.length} байт
        </div>
      )}
    </div>
  );
}

/* ---------- секция ---------- */
export default function NumberFinderSection() {
  const ref = useReveal<HTMLElement>();
  const reduced = usePrefersReducedMotion();
  const [needle, setNeedle] = useState(DEFAULT_NEEDLE);
  const [dumpInput, setDumpInput] = useState("");

  const cands = useMemo(() => buildCandidates(needle), [needle]);
  const dump = useMemo(() => parseDump(dumpInput), [dumpInput]);
  const matches = useMemo(() => findMatches(dump, cands), [dump, cands]);

  const cover = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const mm of matches) {
      const L = cands[mm.cand].bytes.length;
      for (let j = 0; j < L; j++) {
        const idx = mm.start + j;
        if (!m.has(idx)) m.set(idx, []);
        m.get(idx)!.push(mm.cand);
      }
    }
    return m;
  }, [matches, cands]);

  const offsetsByCand = useMemo(() => {
    const map: number[][] = cands.map(() => []);
    for (const mm of matches) map[mm.cand].push(mm.start);
    return map;
  }, [matches, cands]);

  const digits = needle.replace(/\D/g, "");
  const totalFound = matches.length;

  return (
    <section id="finder" ref={ref} className="scroll-mt-16 border-y-2 border-ink bg-night text-mist2">
      <div className="panel-grid mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-24">
        <SectionHead
          dark
          num="04 / Форензика дампа"
          title="Найти номер в данных карты"
          sub="Номер может лежать в памяти по-разному: ASCII-строкой, BCD-упаковкой или двоичным значением. Вставьте номер и дамп (блоки из отчёта или вывод hex-редактора) — инструмент прогонит номер через все типовые кодировки и подсветит совпавшие байты, а готовые сигнатуры можно скопировать для ручного поиска."
        />

        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          {/* панель управления */}
          <div className="flex flex-col gap-5">
            <div className="border-2 border-mist/30 bg-night2/80 p-4">
              <label className="font-mono text-[10.5px] font-bold uppercase tracking-[0.2em] text-amber">
                Номер для поиска
              </label>
              <input
                value={needle}
                onChange={(e) => setNeedle(e.target.value)}
                spellCheck={false}
                className="mt-2 w-full border border-mist/30 bg-night px-3 py-2 font-mono text-[15px] font-bold tracking-[0.06em] text-mist2 outline-none transition-colors focus:border-acc"
                placeholder="например 9643902303304575959"
              />
              <p className="mt-2 font-mono text-[10.5px] text-mist/55">
                цифр: <b className="text-mist2">{digits.length}</b>
                {digits.length % 2 === 1 && <span className="text-amber"> · нечёт → будет BCD-паддинг</span>}
                {needle.trim() !== digits && needle.trim() !== "" && (
                  <span className="text-amber"> · есть нецифровые символы</span>
                )}
              </p>
            </div>

            <div className="border-2 border-mist/30 bg-night2/80 p-4">
              <div className="flex items-center justify-between gap-2">
                <label className="font-mono text-[10.5px] font-bold uppercase tracking-[0.2em] text-amber">
                  Дамп карты (hex)
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDumpInput(buildSampleDump(needle))}
                    className="cursor-pointer border border-led/50 px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase tracking-widest text-led transition-colors hover:bg-led/15"
                  >
                    пример
                  </button>
                  <button
                    type="button"
                    onClick={() => setDumpInput("")}
                    className="cursor-pointer border border-mist/30 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-widest text-mist transition-colors hover:border-acc hover:text-acc"
                  >
                    очистить
                  </button>
                </div>
              </div>
              <textarea
                value={dumpInput}
                onChange={(e) => setDumpInput(e.target.value)}
                spellCheck={false}
                rows={8}
                className="code-scroll mt-2 w-full resize-y border border-mist/30 bg-night px-3 py-2 font-mono text-[11.5px] leading-relaxed text-mist2 outline-none transition-colors focus:border-acc"
                placeholder={"00000000  11 4B 06 12 5A 08 04 00 …\nили блоки из card_report_*.txt"}
              />
              <p className="mt-2 font-mono text-[10.5px] text-mist/55">
                байт в дампе: <b className="text-mist2">{dump.length}</b>
              </p>
            </div>

            {/* сводка */}
            <div className="flex items-center justify-between border-2 border-mist/30 bg-night2/80 px-4 py-3">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-mist/60">Совпадений</span>
              <span
                className={`font-display text-[26px] leading-none ${
                  totalFound ? "text-led" : "text-mist/40"
                }`}
              >
                {totalFound}
              </span>
            </div>

            {totalFound === 0 && dump.length > 0 && (
              <div className="border-l-[3px] border-amber bg-night2/70 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-mist/75">
                Не найдено. Проверьте: номер может быть с разделителями, в другом порядке
                или занимать только часть блока. Скопируйте сигнатуры справа и поищите их
                в hex-редакторе по отдельности.
              </div>
            )}
          </div>

          {/* hex-сетка + сигнатуры */}
          <div className="flex min-w-0 flex-col gap-5">
            <HexGrid dump={dump} cover={cover} cands={cands} reduced={reduced} />

            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-[9px] w-[9px] bg-acc" aria-hidden />
                <h3 className="font-mono text-[11.5px] font-bold uppercase tracking-[0.2em] text-mist2">
                  Сигнатуры — {cands.length} кодировок
                </h3>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {cands.map((c, i) => (
                  <SigRow key={c.name} cand={c} offsets={offsetsByCand[i] ?? []} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
