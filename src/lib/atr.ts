import { ACS_CARD_TYPES } from "../data/sources";

export type RowKind = "ts" | "t0" | "ic" | "hist" | "tck";

export interface AtrRow {
  idx: number;
  name: string;
  hex: string;
  kind: RowKind;
  detail: string;
}

export interface AtrParam {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad" | "acc";
}

export interface AtrResult {
  ok: boolean;
  error?: string;
  rows: AtrRow[];
  params: AtrParam[];
  notes: string[];
}

const FI = [372, 372, 558, 744, 1116, 1488, 1860, 0, 372, 512, 768, 1024, 1536, 2048, 0, 0];
const DI = [0, 1, 2, 4, 8, 16, 32, 64, 12, 20, 0, 0, 0, 0, 0, 0];

const h2 = (b: number) => b.toString(16).toUpperCase().padStart(2, "0");

const COMPACT_TLV_TAGS: Record<number, string> = {
  1: "код страны (ISO 3166)",
  2: "идентификатор эмитента",
  3: "имя DF (AID)",
  4: "RFU",
  5: "имя карты",
  6: "RFU",
  7: "данные эмитента карты",
  8: "RFU / капсюль",
};

function lifeCycle(b: number): string {
  if (b === 0x00 || b === 0xff) return "нет информации";
  if (b === 0x01) return "создание";
  if (b === 0x03 || b === 0x05 || b === 0x07) return "инициализация / персонализация";
  if (b >= 0x0c && b <= 0x0f) return "рабочее состояние (у пользователя)";
  if (b === 0x7f) return "карта недействительна (invalidated)";
  if (b === 0x3f) return "жизненный цикл завершён (terminated)";
  return "значение эмитента";
}

function parseHistorical(hb: number[]): { params: AtrParam[] } {
  const params: AtrParam[] = [];
  if (hb.length === 0) return { params };

  const cat = hb[0];
  params.push({ label: "Индикатор категории", value: `${h2(cat)}` });

  if (cat === 0x00) {
    params[params.length - 1].value += " — компактный TLV (ISO 7816-4)";
    let i = 1;
    while (i < hb.length) {
      const tag = (hb[i] >> 4) & 0x0f;
      const len = hb[i] & 0x0f;
      if (i + 1 + len > hb.length) break;
      const val = hb.slice(i + 1, i + 1 + len).map(h2).join(" ");
      params.push({ label: `TLV ${tag} · ${COMPACT_TLV_TAGS[tag] ?? "RFU"}`, value: val || "пусто" });
      i += 1 + len;
    }
  } else if (cat === 0x10) {
    params[params.length - 1].value += " — ссылка на DIR-файл (EF.DIR)";
    if (hb.length > 1) {
      params.push({ label: "DIR data reference", value: h2(hb[1]) });
    }
  } else if (cat === 0x80) {
    params[params.length - 1].value += " — формат ISO 7816-4";

    if (hb.length > 1) {
      const csd = hb[1];
      const feats: string[] = [];
      if (csd & 0x80) feats.push("выбор приложения полным DF-именем");
      if (csd & 0x40) feats.push("частичным DF-именем");
      if (csd & 0x20) feats.push("есть EF.DIR");
      if (csd & 0x10) feats.push("есть EF.DRD");
      params.push({
        label: "Card Service Data",
        value: feats.length ? feats.join(" · ") : "базовые службы",
      });
    }
    if (hb.length > 4) {
      const c1 = hb[2];
      const c2 = hb[3];
      const caps: string[] = [];
      const coding = (c1 >> 4) & 0x0f;
      if (coding & 0x08) caps.push("бер-ТLV");
      if (coding & 0x04) caps.push("2-состояние");
      if (coding & 0x02) caps.push("3-состояние");
      if (c2 & 0x80) caps.push("command chaining");
      if (c2 & 0x40) caps.push("расширенные Lc/Le");
      const lc = c2 & 0x03;
      if (lc) caps.push(`логических каналов: ${lc}`);
      params.push({
        label: "Возможности карты",
        value: caps.length ? caps.join(" · ") : `байты ${h2(c1)} ${h2(c2)} ${h2(hb[4])}`,
      });
    }
    if (hb.length >= 3) {
      const lcByte = hb[hb.length - 2];
      const sw = h2(hb[hb.length - 1]);
      params.push({ label: "Жизненный цикл", value: lifeCycle(lcByte) });
      params.push({
        label: "Статус SW",
        value: sw === "00" ? "90 00 — норма" : `не 90 00: … ${sw}`,
        tone: sw === "00" ? "ok" : "warn",
      });
    }
    if (hb.length > 6) {
      const ilen = hb[5];
      const issuer = hb.slice(6, Math.min(6 + ilen, hb.length - 2));
      if (issuer.length) {
        params.push({ label: "Данные эмитента", value: issuer.map(h2).join(" ") });
      }
    }
  } else {
    params[params.length - 1].value += " — проприетарный формат эмитента";
    params.push({ label: "Historical bytes", value: hb.map(h2).join(" ") });
  }

  return { params };
}

/* детализация исторических байт синтетического ATR ACS */
function acsHistDetail(hb: number[], j: number): string {
  if (hb[0] !== 0x80) {
    return j === 0 ? "первый байт ATS / ATQB (ISO 14443-4)" : "байт ATS / ATQB";
  }
  switch (j) {
    case 0: return "индикатор категории 80 — структура по ISO 7816-4";
    case 1: return "тег 4F — присутствует идентификатор приложения (AID)";
    case 2: return "длина поля данных (0C)";
    case 3: case 4: case 5: case 6: case 7:
      return "RID A0 00 00 03 06 — PC/SC Workgroup";
    case 8: return "байт стандарта: 03 = ISO 14443-3";
    case 9: return "тип карты, старший байт (C0)";
    case 10: return "тип карты, младший байт (C1)";
    default: return "RFU — зарезервировано (00)";
  }
}

export function parseAtr(input: string): AtrResult {
  const rows: AtrRow[] = [];
  const params: AtrParam[] = [];
  const notes: string[] = [];

  const hex = input.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length < 4) {
    return { ok: false, error: "Слишком коротко: нужен как минимум TS + T0 (2 байта).", rows, params, notes };
  }
  if (hex.length % 2 !== 0) {
    return { ok: false, error: "Нечётное число hex-символов — проверьте строку.", rows, params, notes };
  }

  const b: number[] = [];
  for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16));

  // ---- TS
  const ts = b[0];
  rows.push({
    idx: 0, name: "TS", hex: h2(ts), kind: "ts",
    detail: ts === 0x3b ? "прямая конвенция (direct convention)" :
      ts === 0x3f ? "обратная конвенция (inverse convention)" :
        "неверное значение TS (ожидалось 3B или 3F)",
  });
  if (ts !== 0x3b && ts !== 0x3f) {
    return { ok: false, error: `Неверный TS=${h2(ts)}. ATR всегда начинается с 3B (direct) или 3F (inverse).`, rows, params, notes };
  }
  params.push({ label: "Конвенция", value: ts === 0x3b ? "direct (3B)" : "inverse (3F)" });

  // ---- T0
  const t0 = b[1];
  const K = t0 & 0x0f;

  // ============================================================
  // Синтетический ATR ридеров ACS (ACR122U / 1251U / 1252U / 1281U)
  // По спецификации ACS байты 80 01 — это TD1/TD2, протокол T=1, TCK в конце.
  // ============================================================
  const isAcsPseudo = (t0 >> 4) === 0x8 && b.length >= 4 && b[2] === 0x80 && b[3] === 0x01;
  if (isAcsPseudo) {
    rows.push({
      idx: 1, name: "T0", hex: h2(t0), kind: "t0",
      detail: `по спеке ACS: дальше только TD1 · K=${K} исторических байт`,
    });
    rows.push({ idx: 2, name: "TD1", hex: h2(b[2]), kind: "ic", detail: "дальше TD2 · T=0" });
    rows.push({
      idx: 3, name: "TD2", hex: h2(b[3]), kind: "ic",
      detail: "протокол T=1 · символов больше нет → в конце будет TCK",
    });

    const h0 = 4;
    if (b.length < h0 + K + 1) return truncated(rows, params, notes);
    const hb = b.slice(h0, h0 + K);
    for (let j = 0; j < hb.length; j++) {
      rows.push({ idx: h0 + j, name: `H${j + 1}`, hex: h2(hb[j]), kind: "hist", detail: acsHistDetail(hb, j) });
    }

    const tck = b[h0 + K];
    let x = 0;
    for (let j = 1; j < h0 + K; j++) x ^= b[j];
    const good = x === tck;
    rows.push({
      idx: h0 + K, name: "TCK", hex: h2(tck), kind: "tck",
      detail: good ? `XOR(T0…H${K}) = ${h2(tck)} ✓` : `XOR(T0…H${K}) = ${h2(x)} ≠ ${h2(tck)} — байт повреждён`,
    });

    params.unshift({ label: "Протокол", value: "T=1 (по TD2)" });
    params.unshift({ label: "Длина ATR", value: `${b.length} байт` });
    params.push({ label: "Исторических байт (K)", value: String(K) });
    params.push({ label: "TCK", value: good ? `${h2(tck)} — верен` : `${h2(tck)} — не совпадает!`, tone: good ? "ok" : "bad" });

    notes.push("Это синтетический ATR ридеров ACS (PC/SC Part 3): бесконтактная карта эмулируется как контактная T=1, поэтому структура читается по таблице ACS, а не по «букве» ISO 7816-3.");

    if (hb[0] === 0x80 && hb.length >= 11) {
      const code = (hb[9] << 8) | hb[10];
      const name = ACS_CARD_TYPES[code];
      params.push({
        label: "Тип карты (ACS)",
        value: name ? `${h2(hb[9])} ${h2(hb[10])} → ${name}` : `${h2(hb[9])} ${h2(hb[10])} — кода нет в таблице ACS`,
        tone: "acc",
      });
      params.push({ label: "RID", value: `${hb.slice(3, 8).map(h2).join(" ")} — PC/SC Workgroup` });
      notes.push(`Тип карты зашит в исторических байтах H10–H11 (C0 C1): ${h2(hb[9])} ${h2(hb[10])}.`);
    } else if (hb[0] !== 0x80) {
      notes.push("Исторические байты — это ATS (ISO 14443-4 Type A) или ATQB (Type B) карты, а не структура ISO 7816-4.");
    }

    if (b.length > h0 + K + 1) {
      notes.push(`После TCK осталось ${b.length - (h0 + K + 1)} лишних байт.`);
    }
    return { ok: true, rows, params, notes };
  }

  // ============================================================
  // Обычный ATR по ISO 7816-3
  // ============================================================
  rows.push({
    idx: 1, name: "T0", hex: h2(t0), kind: "t0",
    detail: `Y1=${((t0 >> 4) & 0xf).toString(2).padStart(4, "0")} (какие символы следуют) · K=${K} исторических байт`,
  });

  let i = 2;
  let Y = (t0 >> 4) & 0xf;
  let setNum = 1;
  const protocols = new Set<number>();
  let protocolOfSet = 0;
  let F = 372, D = 1, N: number | null = null;
  let bwi: number | null = null, cwi: number | null = null;

  while (Y !== 0) {
    const hasTA = !!(Y & 0x8);
    const hasTB = !!(Y & 0x4);
    const hasTC = !!(Y & 0x2);
    const hasTD = !!(Y & 0x1);

    if (hasTA) {
      if (i >= b.length) return truncated(rows, params, notes);
      const v = b[i];
      let detail = "";
      if (setNum === 1) {
        F = FI[(v >> 4) & 0xf]; D = DI[v & 0xf];
        if (F === 0 || D === 0) {
          detail = `Fi/Di = RFU (байт ${h2(v)}) — действуют значения по умолчанию F=372, D=1`;
          F = 372; D = 1;
        } else {
          detail = `F=${F} · D=${D} → F/D=${(F / D).toFixed(2).replace(/\.00$/, "")} этu/бит`;
        }
      } else {
        detail = setNum === 2
          ? "TA2: специфический режим — протокол фиксирован (из TD1)"
          : setNum === 3 ? "TA3: IFSC — макс. размер кадра для T=1" : `TA${setNum}: параметры набора ${setNum}`;
      }
      rows.push({ idx: i, name: `TA${setNum}`, hex: h2(v), kind: "ic", detail });
      i++;
    }
    if (hasTB) {
      if (i >= b.length) return truncated(rows, params, notes);
      const v = b[i];
      rows.push({
        idx: i, name: `TB${setNum}`, hex: h2(v), kind: "ic",
        detail: setNum === 1 ? "TB1: VPP больше не используется (устарел)" : "TB2: устарел (VPP)",
      });
      i++;
    }
    if (hasTC) {
      if (i >= b.length) return truncated(rows, params, notes);
      const v = b[i];
      let detail = `TC${setNum}`;
      if (setNum === 1) {
        N = v;
        detail = `TC1: N=${v} — добавочное время охраны (guard time)`;
      } else {
        bwi = (v >> 4) & 0xf;
        cwi = v & 0xf;
        detail = `TC${setNum} для T=${protocolOfSet}: BWI=${bwi} · CWI=${cwi} (таймауты блока/символа)`;
      }
      rows.push({ idx: i, name: `TC${setNum}`, hex: h2(v), kind: "ic", detail });
      i++;
    }
    if (hasTD) {
      if (i >= b.length) return truncated(rows, params, notes);
      const v = b[i];
      const Ynext = (v >> 4) & 0xf;
      const T = v & 0xf;
      protocolOfSet = T;
      protocols.add(T);
      rows.push({
        idx: i, name: `TD${setNum}`, hex: h2(v), kind: "ic",
        detail: `протокол T=${T}` + (Ynext ? ` · дальше идут символы набора ${setNum + 1}` : " · символов больше нет"),
      });
      Y = Ynext;
      setNum++;
      i++;
      continue;
    }
    Y = 0;
  }

  const anyNonT0 = [...protocols].some((p) => p !== 0);

  // ---- historical bytes
  if (i + K > b.length) return truncated(rows, params, notes);
  const hb = b.slice(i, i + K);
  for (let j = 0; j < hb.length; j++) {
    rows.push({
      idx: i + j, name: `H${j + 1}`, hex: h2(hb[j]), kind: "hist",
      detail: j === 0 ? "первый исторический байт — индикатор категории (разбор ниже)" : "исторический байт (разбор категории — ниже)",
    });
  }
  i += K;
  params.push({ label: "Исторических байт (K)", value: String(K) });
  if (K > 0) {
    params.push(...parseHistorical(hb).params);
  }

  // ---- TCK
  if (anyNonT0) {
    if (i >= b.length) return truncated(rows, params, notes);
    const tck = b[i];
    let x = 0;
    for (let j = 1; j < i; j++) x ^= b[j];
    const good = x === tck;
    rows.push({
      idx: i, name: "TCK", hex: h2(tck), kind: "tck",
      detail: good ? "контрольный байт: XOR(T0…H) совпадает ✓" : `контрольный байт неверен: XOR(T0…H)=${h2(x)} ≠ ${h2(tck)}`,
    });
    params.push({ label: "TCK", value: good ? `${h2(tck)} — верен` : `${h2(tck)} — не совпадает!`, tone: good ? "ok" : "bad" });
    i++;
  }

  if (i < b.length) {
    notes.push(`После разбора осталось ${b.length - i} лишних байт — возможно, ATR склеен с ответом карты.`);
  }

  // ---- protocol & timing
  const protoList = [...new Set([0, ...protocols])].sort((a, z) => a - z);
  params.unshift({
    label: "Протокол",
    value: protoList.length === 1 && protoList[0] === 0 ? "T=0" : protoList.map((p) => `T=${p}`).join(" + "),
  });
  params.unshift({ label: "Длина ATR", value: `${b.length} байт` });
  if (F !== 372 || D !== 1) {
    params.push({
      label: "F/D · скорость",
      value: `F=${F}, D=${D} · до ${Math.round((3579545 * D) / F).toLocaleString("ru-RU")} бит/с при 3.58 МГц`,
    });
  }
  if (N !== null) params.push({ label: "Guard time N", value: `${N} этu` });
  if (bwi !== null) {
    const bwt = ((2 ** bwi) * 960 * 372 / 3579545) * 1000;
    params.push({ label: "BWI / CWI", value: `BWI=${bwi} (BWT ≈ ${bwt < 10 ? bwt.toFixed(1) : Math.round(bwt)} мс) · CWI=${cwi}` });
  }

  return { ok: true, rows, params, notes };
}

function truncated(rows: AtrRow[], params: AtrParam[], notes: string[]): AtrResult {
  return {
    ok: false,
    error: "ATR оборван: T0 обещает больше байт, чем есть в строке. Живая карта так не отвечает — проверьте захват.",
    rows,
    params,
    notes,
  };
}
