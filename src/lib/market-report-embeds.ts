export interface MarketReportEmbed { kind: "transactions" | "rents" | "metrics"; community?: string }
export type ReportSegment = { markdown: string } | { embed: MarketReportEmbed };
/** Fixed data views only; no HTML, script, arbitrary URL or component names. */
export function parseMarketReportEmbeds(body: string): ReportSegment[] {
  const tokens = /\[\[market-data:([^\]]*)\]\]/g;
  const segments: ReportSegment[] = [];
  let offset = 0, count = 0;
  for (const match of body.matchAll(tokens)) {
    const [kind, community, extra] = match[1].split(":");
    if (!["transactions", "rents", "metrics"].includes(kind) || extra !== undefined || (community && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(community)) || (community?.length ?? 0) > 180 || ++count > 3) throw new Error("Use at most three market-data embeds with transactions, rents or metrics and an optional community slug.");
    if (match.index! > offset) segments.push({ markdown: body.slice(offset, match.index) });
    segments.push({ embed: { kind: kind as MarketReportEmbed["kind"], ...(community ? { community } : {}) } });
    offset = match.index! + match[0].length;
  }
  if (offset < body.length) segments.push({ markdown: body.slice(offset) });
  return segments;
}
