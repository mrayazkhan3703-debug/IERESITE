export type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "link"; label: string; href: string }
  | { type: "image"; mediaId: string; altText: string; caption?: string }
  | { type: "entity"; entity: "property" | "project" | "community" | "developer" | "advisor"; slug: string; label: string }
  | { type: "module"; id: "property-search" | "calculator-hub" | "market-intelligence" | "property-map" | "advisor-contact" | "featured-properties" };

const MAX_BLOCKS = 100;
const MAX_TEXT = 50_000;

export function isSafeContentHref(href: string): boolean {
  const value = href.trim();
  if (!value || value.length > 2_000 || /[\u0000-\u001f\\]/.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

function boundedString(value: unknown, max: number, min = 1): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

/** Returns null for malformed input. An empty array is a valid empty document. */
export function parseContentBlocks(value: unknown): ContentBlock[] | null {
  if (!Array.isArray(value) || value.length > MAX_BLOCKS) return null;
  const blocks: ContentBlock[] = [];
  const moduleIds = new Set<string>();
  let totalText = 0;

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const block = item as Record<string, unknown>;
    let parsed: ContentBlock;
    switch (block.type) {
      case "paragraph":
        if (!boundedString(block.text, 5_000)) return null;
        parsed = { type: "paragraph", text: block.text };
        break;
      case "heading":
        if ((block.level !== 2 && block.level !== 3) || !boundedString(block.text, 200)) return null;
        parsed = { type: "heading", level: block.level, text: block.text };
        break;
      case "quote":
        if (!boundedString(block.text, 3_000) || (block.attribution !== undefined && !boundedString(block.attribution, 160))) return null;
        parsed = { type: "quote", text: block.text, ...(block.attribution ? { attribution: block.attribution } : {}) };
        break;
      case "list":
        if (typeof block.ordered !== "boolean" || !Array.isArray(block.items) || block.items.length < 1 || block.items.length > 30 || !block.items.every((entry) => boundedString(entry, 500))) return null;
        parsed = { type: "list", ordered: block.ordered, items: block.items as string[] };
        break;
      case "link":
        if (!boundedString(block.label, 200) || typeof block.href !== "string" || !isSafeContentHref(block.href)) return null;
        parsed = { type: "link", label: block.label, href: block.href.trim() };
        break;
      case "image":
        if (!boundedString(block.mediaId, 128) || !boundedString(block.altText, 300) || (block.caption !== undefined && !boundedString(block.caption, 500))) return null;
        parsed = { type: "image", mediaId: block.mediaId, altText: block.altText, ...(block.caption ? { caption: block.caption } : {}) };
        break;
      case "module":
        if (!["property-search", "calculator-hub", "market-intelligence", "property-map", "advisor-contact", "featured-properties"].includes(String(block.id))) return null;
        if (moduleIds.has(String(block.id))) return null;
        moduleIds.add(String(block.id));
        parsed = { type: "module", id: block.id as Extract<ContentBlock, { type: "module" }>["id"] };
        break;
      case "entity":
        if (!["property", "project", "community", "developer", "advisor"].includes(String(block.entity)) || !boundedString(block.label, 200) || typeof block.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(block.slug) || block.slug.length > 180) return null;
        parsed = { type: "entity", entity: block.entity as Extract<ContentBlock, { type: "entity" }>["entity"], slug: block.slug, label: block.label };
        break;
      default:
        return null;
    }
    totalText += "text" in parsed
      ? parsed.text.length + (parsed.type === "quote" ? parsed.attribution?.length ?? 0 : 0)
      : parsed.type === "list" ? parsed.items.reduce((length, text) => length + text.length, 0)
          : parsed.type === "link" ? parsed.label.length + parsed.href.length
          : parsed.type === "image" ? parsed.altText.length + (parsed.caption?.length ?? 0) : parsed.type === "entity" ? parsed.label.length + parsed.slug.length : 0;
    if (totalText > MAX_TEXT) return null;
    blocks.push(parsed);
  }
  return blocks;
}

export function readContentBlocks(serialized: string | null | undefined): ContentBlock[] | null {
  if (!serialized) return null;
  try {
    const parsed = parseContentBlocks(JSON.parse(serialized));
    return parsed && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}
