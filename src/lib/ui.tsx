import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

/* ============================================================
   Хуки и мелкие UI-атомы
   ============================================================ */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fn = () => setReduced(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return reduced;
}

/** Scroll-reveal: вешает класс .on при входе в вьюпорт */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("on");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    el.querySelectorAll(".reveal").forEach((child) => io.observe(child));
    return () => io.disconnect();
  }, []);
  return ref;
}

export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  const copy = useCallback((text: string) => {
    const done = () => {
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* noop */
      }
      document.body.removeChild(ta);
      done();
    }
  }, []);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  return [copied, copy];
}

export function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

/* ============================================================
   Мини-подсветка Python
   ============================================================ */

const PY_RE =
  /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?''')|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(def|class|return|if|elif|else|for|while|in|not|and|or|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|assert|del|is|None|True|False)\b|\b(print|len|range|str|int|bytes|list|dict|open|enumerate|sum|hex|max|sorted|getattr|isinstance|Exception|self)\b|(\b\d+(?:\.\d+)?\b(?:e[+-]?\d+)?)/g;

export function highlightPython(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  const re = new RegExp(PY_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index));
    if (m[1]) out.push(<span key={key++} className="tok-c">{m[1]}</span>);
    else if (m[2] || m[3]) out.push(<span key={key++} className="tok-s">{m[2] ?? m[3]}</span>);
    else if (m[4]) out.push(<span key={key++} className="tok-k">{m[4]}</span>);
    else if (m[5]) out.push(<span key={key++} className="tok-b">{m[5]}</span>);
    else if (m[6]) out.push(<span key={key++} className="tok-n">{m[6]}</span>);
    last = re.lastIndex;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

/* ============================================================
   Атомы
   ============================================================ */

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[11px] font-semibold tracking-[0.22em] uppercase text-acc">
      <span className="inline-block h-[9px] w-[9px] bg-acc" aria-hidden />
      {children}
    </div>
  );
}

export function SectionHead({
  num,
  title,
  sub,
  dark = false,
}: {
  num: string;
  title: string;
  sub?: string;
  dark?: boolean;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="reveal mb-10 md:mb-12">
      <Kicker>{num}</Kicker>
      <h2
        className={`mask-line mt-3 font-display text-[clamp(1.7rem,4.6vw,3.1rem)] leading-[1.05] uppercase ${dark ? "text-mist2" : "text-ink"}`}
      >
        <span>{title}</span>
      </h2>
      {sub && (
        <p className={`mt-4 max-w-2xl text-[15px] leading-relaxed ${dark ? "text-mist" : "text-ink2/80"}`}>
          {sub}
        </p>
      )}
    </div>
  );
}

export function HardButton({
  children,
  onClick,
  variant = "ink",
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "ink" | "acc" | "paper";
  className?: string;
  title?: string;
}) {
  const base =
    "btn-hard inline-flex cursor-pointer items-center gap-2 border-2 border-ink px-4 py-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em]";
  const variants = {
    ink: "bg-ink text-paper hover:bg-acc hover:border-ink hover:text-ink",
    acc: "bg-acc text-ink btn-hard-acc hover:bg-amber",
    paper: "bg-paper text-ink hover:bg-amber",
  } as const;
  return (
    <button type="button" title={title} onClick={onClick} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

/* Чип статуса */
export function StatusChip({ tone, children }: { tone: "ok" | "warn" | "bad" | "acc" | "info"; children: ReactNode }) {
  const map = {
    ok: "border-led/60 bg-led/10 text-[#1e7a46]",
    warn: "border-amber/70 bg-amber/15 text-[#8a5c05]",
    bad: "border-acc/70 bg-acc/10 text-acc-deep",
    acc: "border-acc/60 bg-acc/10 text-acc-deep",
    info: "border-line bg-paper2 text-ink2",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

/* ============================================================
   Иконки (рисованные вручную)
   ============================================================ */

const ic = "inline-block shrink-0";

export function IconCard({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`${ic} ${className}`}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <rect x="6" y="9.5" width="4.5" height="4" rx="0.8" fill="currentColor" stroke="none" opacity="0.9" />
      <path d="M14.5 9a4 4 0 0 1 0 6M17 7.5a7 7 0 0 1 0 9" strokeLinecap="round" />
    </svg>
  );
}

export function IconChip({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`${ic} ${className}`}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" strokeLinecap="round" />
    </svg>
  );
}

export function IconWave({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`${ic} ${className}`}>
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconFile({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`${ic} ${className}`}>
      <path d="M6 2.5h8l4 4V21.5H6z" strokeLinejoin="round" />
      <path d="M14 2.5v4h4" strokeLinejoin="round" />
      <path d="M9 12h6M9 15.5h6M9 8.5h2" strokeLinecap="round" />
    </svg>
  );
}

export function IconKey({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`${ic} ${className}`}>
      <circle cx="8" cy="15.5" r="4.5" />
      <circle cx="8" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M11.5 12.5 20 4M16.5 7.5l3 3M14 10l2 2" strokeLinecap="round" />
    </svg>
  );
}

export function IconUsb({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`${ic} ${className}`}>
      <path d="M12 21V7M12 7l-3.5 3.5M12 10.5 15.5 14" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="4.5" r="1.8" />
      <rect x="4.8" y="13.8" width="3.4" height="3.4" transform="rotate(45 6.5 15.5)" />
      <circle cx="16.8" cy="15.5" r="1.7" />
      <rect x="10.4" y="19" width="3.2" height="3.2" rx="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconTerminal({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`${ic} ${className}`}>
      <rect x="2.5" y="4" width="19" height="16" rx="1.5" />
      <path d="m6.5 9 3.5 3-3.5 3M12.5 15.5H17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={`${ic} ${className}`}>
      <path d="M4 12h15M13 5.5 19.5 12 13 18.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
