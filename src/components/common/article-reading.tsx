"use client";

import * as React from "react";
import { ListTree } from "lucide-react";

/* ------------------------------------------------------------------ */
/* TOC extraction from markdown source                                  */
/* ------------------------------------------------------------------ */

export interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
  );
}

function childrenToText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join("");
  if (React.isValidElement(children)) return childrenToText((children.props as { children?: React.ReactNode }).children);
  return "";
}

/** Deterministic heading id for ReactMarkdown overrides (stable across renders). */
export function tocId(children: React.ReactNode): string {
  return slugify(childrenToText(children));
}

/** Extract h2/h3 outline from markdown. Skips fenced code blocks. */
export function extractToc(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  const seen = new Map<string, number>();
  let inCode = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const m = /^(##|###)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/[*_`]/g, "").trim();
    let id = slugify(text);
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n > 0) id = `${id}-${n}`;
    items.push({ id, text, level: m[1] === "##" ? 2 : 3 });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Reading progress bar                                                  */
/* ------------------------------------------------------------------ */

/** Fixed top progress bar tracking scroll through the article element. */
export function ReadingProgress({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const total = rect.height - window.innerHeight * 0.6;
        const done = Math.min(Math.max(-rect.top + window.innerHeight * 0.3, 0), Math.max(total, 1));
        setProgress(total > 0 ? done / total : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [targetRef]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] bg-transparent print:hidden">
      <div
        className="h-full bg-gradient-to-r from-brand to-brand-strong transition-[width] duration-150 ease-out"
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar table of contents with scroll-spy                            */
/* ------------------------------------------------------------------ */

export function TableOfContents({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (items.length === 0) return;
    const headings = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Active = the last heading above the viewport middle
        const visible = entries.filter((e) => e.isIntersecting).map((e) => e.target.id);
        if (visible.length > 0) {
          setActiveId(visible[0]);
          return;
        }
        const passed = headings.filter((h) => h.getBoundingClientRect().top < window.innerHeight * 0.4);
        setActiveId(passed.length > 0 ? passed[passed.length - 1].id : items[0].id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 1] }
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [items]);

  if (items.length < 3) return null;

  return (
    <nav aria-label="On this page" className="rounded-xl border border-border/70 bg-card p-5">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        <ListTree className="h-4 w-4 text-brand" aria-hidden /> On this page
      </p>
      <ul className="mt-3.5 space-y-1.5">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={
                "block border-l-2 py-1 text-sm leading-relaxed transition-all duration-150 " +
                (item.level === 3 ? "pl-5 " : "pl-3 ") +
                (activeId === item.id
                  ? "border-brand font-medium text-brand-strong"
                  : "border-border/60 text-muted-foreground hover:border-brand/50 hover:text-foreground")
              }
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
