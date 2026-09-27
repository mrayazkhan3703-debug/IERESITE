"use client";

import Image from "next/image";
import ReactMarkdown from "react-markdown";
import { parseContentBlocks, type ContentBlock } from "@/lib/content-blocks";
import { tocId } from "@/components/common/article-reading";

function safeBlocks(value: unknown): ContentBlock[] | null {
  const parsed = parseContentBlocks(value);
  return parsed && parsed.length ? parsed : null;
}

export function contentBlocksToToc(value: unknown) {
  const blocks = safeBlocks(value);
  if (!blocks) return [];
  const seen = new Map<string, number>();
  return blocks.flatMap((block) => {
    if (block.type !== "heading") return [];
    const base = tocId(block.text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return [{ id: count ? `${base}-${count}` : base, text: block.text, level: block.level }];
  });
}

function renderBlocks(blocks: ContentBlock[]) {
  const seenHeadings = new Map<string, number>();
  return blocks.map((block, index) => {
    switch (block.type) {
      case "paragraph":
        return <p key={index} className="mt-4 whitespace-pre-wrap text-foreground/85">{block.text}</p>;
      case "heading": {
        const base = tocId(block.text);
        const count = seenHeadings.get(base) ?? 0;
        seenHeadings.set(base, count + 1);
        const id = count ? `${base}-${count}` : base;
        return block.level === 2
          ? <h2 key={index} id={id} className="mt-10 scroll-mt-28 font-display text-2xl font-semibold first:mt-0">{block.text}</h2>
          : <h3 key={index} id={id} className="mt-8 scroll-mt-28 font-display text-xl font-semibold">{block.text}</h3>;
      }
      case "quote":
        return <figure key={index} className="mt-5 border-s-2 border-brand ps-4 text-foreground/85"><blockquote className="whitespace-pre-wrap">{block.text}</blockquote>{block.attribution && <figcaption className="mt-2 text-sm text-muted-foreground">{block.attribution}</figcaption>}</figure>;
      case "list": {
        const List = block.ordered ? "ol" : "ul";
        return <List key={index} className={`mt-4 space-y-1.5 ps-5 text-foreground/85 ${block.ordered ? "list-decimal" : "list-disc"}`}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</List>;
      }
      case "link": {
        const external = /^https?:\/\//i.test(block.href);
        return <p key={index} className="mt-4"><a href={block.href} className="text-brand-strong underline underline-offset-2" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{block.label}</a></p>;
      }
      case "image":
        return <figure key={index} className="my-6"><Image src={`/api/media/${encodeURIComponent(block.mediaId)}/content`} alt={block.altText} width={1200} height={800} unoptimized className="h-auto w-full rounded-lg" />{block.caption && <figcaption className="mt-2 text-center text-sm text-muted-foreground">{block.caption}</figcaption>}</figure>;
    }
  });
}

export function ContentBody({ body, blocks, className = "" }: { body: string; blocks?: unknown; className?: string }) {
  const parsedBlocks = safeBlocks(blocks);
  if (parsedBlocks) return <div className={`content-body ${className}`}>{renderBlocks(parsedBlocks)}</div>;
  return <div className={`content-body ${className}`}><ReactMarkdown
    components={{
      h1: (props) => <h2 id={tocId(props.children)} className="mt-10 scroll-mt-28 font-display text-2xl font-semibold first:mt-0" {...props} />,
      h2: (props) => <h3 id={tocId(props.children)} className="mt-8 scroll-mt-28 font-display text-xl font-semibold" {...props} />,
      h3: (props) => <h4 id={tocId(props.children)} className="mt-6 scroll-mt-28 font-display text-lg font-semibold" {...props} />,
      p: (props) => <p className="mt-4 text-foreground/85" {...props} />,
      ul: (props) => <ul className="mt-4 list-disc space-y-1.5 ps-5 text-foreground/85" {...props} />,
      ol: (props) => <ol className="mt-4 list-decimal space-y-1.5 ps-5 text-foreground/85" {...props} />,
      a: (props) => <a className="text-brand-strong underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...props} />,
      strong: (props) => <strong className="font-semibold text-foreground" {...props} />,
      em: (props) => <em className="text-muted-foreground" {...props} />,
    }}
  >{body}</ReactMarkdown></div>;
}
