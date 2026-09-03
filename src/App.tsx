import { downloadFile, HardButton, IconCard, IconChip, IconFile, IconKey, IconTerminal, IconWave, SectionHead, useReveal } from "./lib/ui";
import { PY_SOURCE } from "./data/sources";
import ScannerPanel from "./components/ScannerPanel";
import ProgramTabs from "./components/CodeViewer";
import AtrParser from "./components/AtrParser";
import GuiSection from "./components/GuiSection";
import { CardsTable, CommandsTable, Faq, Footer, InstallSteps, ReportPreview, Ticker } from "./components/Sections";

/* ---------- шапка ---------- */
function Header() {
  return (
    <header className="sticky top-0 z-50 border-b-2 border-acc bg-night text-mist2">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3 md:px-8">
        <a href="#top" className="group flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center border-2 border-acc text-acc transition-colors group-hover:bg-acc group-hover:text-ink">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4.5 w-4.5">
              <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
              <rect x="6" y="9.5" width="4.5" height="4" rx="0.8" fill="currentColor" stroke="none" />
              <path d="M14.5 9a4 4 0 0 1 0 6" strokeLinecap="round" />
            </svg>
          </span>
          <span className="font-mono text-[12.5px] font-bold tracking-[0.18em]">
            ACR1281U<span className="text-acc">·</span>DUMP
          </span>
        </a>
        <nav className="hidden items-center gap-6 font-mono text-[11.5px] font-semibold uppercase tracking-[0.14em] lg:flex">
          {[
            ["#program", "Программа"],
            ["#atr", "ATR"],
            ["#output", "Отчёт"],
            ["#gui", "GUI"],
            ["#install", "Установка"],
            ["#cards", "Карты"],
            ["#faq", "FAQ"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="group relative text-mist transition-colors hover:text-amber">
              {label}
              <span className="absolute -bottom-1 left-0 h-[2px] w-0 bg-amber transition-all duration-300 group-hover:w-full" />
            </a>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => downloadFile("acr1281_dump.py", PY_SOURCE)}
          className="btn-hard-acc btn-hard cursor-pointer border-2 border-acc bg-acc px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-amber"
        >
          ⬇ .py
        </button>
      </div>
    </header>
  );
}

/* ---------- контрольная панель секции 01 ---------- */
const COLLECTS = [
  { icon: IconCard, title: "UID и NFCID", text: "FF CA 00 00 00 — серийный номер 4/7/10 байт" },
  { icon: IconTerminal, title: "ATR и протокол", text: "ответ на сброс, T=0/T=1, исторические байты" },
  { icon: IconWave, title: "ATQA / SAK", text: "SENS_RES и SEL_RES из Polling → точный тип карты" },
  { icon: IconKey, title: "Сектора Mifare", text: "перебор 8 заводских ключей, дамп блоков 1K/4K/Mini" },
  { icon: IconChip, title: "EMV-приложения", text: "AID из каталога PPSE для контактных банковских карт" },
  { icon: IconFile, title: "Файл-отчёт", text: "«параметр : значение» + JSON-копия, имя по UID и дате" },
];

function ProgramSection() {
  const ref = useReveal<HTMLElement>();
  return (
    <section id="program" ref={ref} className="scroll-mt-16">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-24">
        <SectionHead
          num="01 / Программа"
          title="Один скрипт — полный дамп"
          sub="acr1281_dump.py сам находит ридер в системе, определяет тип карты и собирает всё, что отдаёт ACR1281U по PC/SC. На выходе — два файла: человекочитаемый отчёт и JSON для дальнейшей обработки."
        />
        <div className="grid gap-8 lg:grid-cols-[0.92fr_1.45fr]">
          <div className="flex flex-col gap-4">
            {COLLECTS.map((c, i) => (
              <div
                key={c.title}
                className="reveal group flex items-start gap-4 border-2 border-ink bg-paper p-4 shadow-[5px_5px_0_0_rgba(13,27,38,0.12)] transition-all duration-300 hover:-translate-y-0.5 hover:border-acc hover:shadow-[7px_7px_0_0_rgba(240,86,28,0.85)]"
                style={{ transitionDelay: `${i * 55}ms` }}
              >
                <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center border-2 border-ink bg-night text-amber transition-colors group-hover:bg-acc group-hover:text-ink">
                  <c.icon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-display text-[14.5px] uppercase text-ink">{c.title}</h3>
                  <p className="mt-1 font-mono text-[12px] leading-relaxed text-ink2/75">{c.text}</p>
                </div>
              </div>
            ))}

            <div className="reveal mt-2 border-2 border-ink bg-night p-4 font-mono text-[12.5px] leading-[1.9] text-mist">
              <p className="text-mist/60"># запуск</p>
              <p><span className="text-amber">C:\cards&gt;</span> <span className="text-mist2">python acr1281_dump.py</span></p>
              <p><span className="text-mist/70">[*]</span> Ридер: ACS ACR1281U-C1 ContactlessReader 0</p>
              <p><span className="text-mist/70">[*]</span> Mifare Classic: читаю сектора...</p>
              <p><span className="text-led">[+]</span> <span className="text-amber">card_report_04A12B324C5880_20260214_210733.txt</span></p>
            </div>
          </div>
          <div className="reveal">
            <ProgramTabs />
          </div>
        </div>
      </div>
    </section>
  );
}

function AtrSection() {
  const ref = useReveal<HTMLElement>();
  return (
    <section id="atr" ref={ref} className="scroll-mt-16 border-y-2 border-ink bg-paper2/70">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-24">
        <SectionHead
          num="02 / Разбор ATR"
          title="Что карта ответила на сброс"
          sub="ATR из вашего отчёта можно расшифровать прямо здесь: конвенция, Fi/Di и скорость, протоколы T=0/T=1, исторические байты по ISO 7816-4 — и автоматическое определение типа бесконтактной карты в синтетических ATR ридеров ACS."
        />
        <div className="reveal">
          <AtrParser />
        </div>
      </div>
    </section>
  );
}

function OutputSection() {
  const ref = useReveal<HTMLElement>();
  return (
    <section id="output" ref={ref} className="scroll-mt-16">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-24">
        <SectionHead
          num="03 / Файл результата"
          title="Параметры и значения — в файл"
          sub="Пример реального вывода для Mifare Classic 1K: каждый параметр парой «имя : значение», ниже — hex-дамп прочитанных блоков. Рядом JSON-копия тех же данных."
        />
        <div className="reveal">
          <ReportPreview />
        </div>
      </div>
    </section>
  );
}

function InstallSection() {
  const ref = useReveal<HTMLElement>();
  return (
    <section id="install" ref={ref} className="scroll-mt-16 border-y-2 border-ink bg-night text-mist2">
      <div className="panel-grid mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-24">
        <SectionHead
          dark
          num="05 / Установка · Windows"
          title="От нуля до первого чтения"
          sub="Пять шагов: Python, CCID-драйвер ридера, pyscard, файл скрипта и запуск. Команды копируются кликом."
        />
        <InstallSteps />
      </div>
    </section>
  );
}

function CardsSection() {
  const ref = useReveal<HTMLElement>();
  return (
    <section id="cards" ref={ref} className="scroll-mt-16">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-24">
        <SectionHead
          num="06 / Карты и команды"
          title="Что умеет связка ACR1281U + скрипт"
          sub="Ридер двухинтерфейсный: верхняя площадка — бесконтактные ISO 14443 A/B и FeliCa, щель — контактные ISO 7816. Скрипт работает с обоими."
        />
        <div className="reveal mb-14">
          <CardsTable />
        </div>
        <div className="reveal mb-5 flex items-center gap-3">
          <span className="inline-block h-[9px] w-[9px] bg-acc2" aria-hidden />
          <h3 className="font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-ink2">
            Шпаргалка APDU, которую использует скрипт
          </h3>
        </div>
        <div className="reveal">
          <CommandsTable />
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  const ref = useReveal<HTMLElement>();
  return (
    <section id="faq" ref={ref} className="scroll-mt-16 border-t-2 border-ink bg-paper2/70">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-24">
        <SectionHead
          num="07 / Вопросы"
          title="Если что-то пошло не так"
          sub="Типичные ошибки PC/SC под Windows и их лечение — от «модуль не найден» до «сектора не читаются»."
        />
        <Faq />
        <div className="reveal mt-10 flex flex-wrap items-center justify-between gap-4 border-2 border-ink bg-ink px-5 py-4 text-paper">
          <p className="font-mono text-[12.5px] tracking-[0.06em]">
            <span className="text-amber">Остался вопрос?</span> Перечитайте лог скрипта — он печатает каждый шаг и код ответа SW.
          </p>
          <HardButton variant="acc" onClick={() => downloadFile("acr1281_dump.py", PY_SOURCE)}>
            ⬇ Скачать скрипт ещё раз
          </HardButton>
        </div>
      </div>
    </section>
  );
}

/* ---------- приложение ---------- */
export default function App() {
  return (
    <div className="min-h-screen">
      <div className="noise-overlay" aria-hidden />
      <Header />
      <main>
        <ScannerPanel />
        <Ticker />
        <ProgramSection />
        <AtrSection />
        <OutputSection />
        <GuiSection />
        <InstallSection />
        <CardsSection />
        <FaqSection />
      </main>
      <Footer />
    </div>
  );
}
