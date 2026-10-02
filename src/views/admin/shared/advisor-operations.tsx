"use client";
import * as React from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import type { aiReadiness } from "@/server/ai/readiness";
import type { ragDiagnostics } from "@/server/rag/diagnostics";
type Readiness = Awaited<ReturnType<typeof aiReadiness>>;
type Knowledge = Awaited<ReturnType<typeof ragDiagnostics>>;
export function AdvisorOperations({ canManage }: { canManage: boolean }) {
  const [readiness, setReadiness] = React.useState<Readiness | null>(null);
  const [knowledge, setKnowledge] = React.useState<Knowledge | null>(null);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
  const [scenario, setScenario] = React.useState("MINIMAL");
  const [message, setMessage] = React.useState("");
  const load = React.useCallback(async (cursor = "") => {
    setError("");
    try { const [provider, index] = await Promise.all([api.get<Readiness>("/api/admin/ai/readiness"), api.get<Knowledge>("/api/admin/rag/index" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""))]); setReadiness(provider); setKnowledge(index); }
    catch { setError("Advisor diagnostics could not be loaded. Refresh to retry."); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  async function verify() {
    setBusy(true); setError(""); setMessage("");
    try { const result = await api.post<{ succeeded: boolean; reason: string | null; latencyMs: number; diagnostics?: { httpStatus: number; providerCode: string | null; requestId: string | null } | null; readiness: Readiness }>("/api/admin/ai/readiness", { action: "VERIFY_PROVIDER", scenario }); setReadiness(result.readiness); setMessage(result.succeeded ? `Provider verification succeeded in ${result.latencyMs} ms.` : `Verification did not succeed: ${result.reason}.${result.diagnostics ? ` HTTP ${result.diagnostics.httpStatus} · ${result.diagnostics.providerCode ?? "no provider code"} · request ${result.diagnostics.requestId ?? "not supplied"}` : ""}`); }
    catch { setError("Provider verification could not be completed. Refresh diagnostics before retrying."); }
    finally { setBusy(false); }
  }
  async function index() {
    const documents = knowledge?.documents.filter((doc) => doc.canIndex).slice(0, 10).map(({ id, version }) => ({ id, version })) ?? [];
    if (!documents.length) return;
    setBusy(true); setError(""); setMessage("");
    try { const result = await api.post<{ results: { indexed: boolean }[] }>("/api/admin/rag/index", { documents }); setMessage(`${result.results.filter((doc) => doc.indexed).length} of ${documents.length} reviewed revisions indexed. Refresh the list for current exclusions.`); await load(); }
    catch { setError("Indexing could not be completed. Existing approval and revision checks remain enforced."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Advisor readiness and knowledge indexing" className="space-y-3 rounded-xl border p-4">
    <h2 className="text-lg font-semibold">Advisor readiness</h2>
    <p className="text-sm text-muted-foreground">Live conversations use Inception Mercury. The server requires INCEPTION_API_KEY; this screen never displays credentials. Verification sends a real provider request and consumes the configured budget.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {readiness ? <><p>{readiness.provider} · {readiness.model} · <strong>{readiness.status}</strong>{readiness.reason ? ` · ${readiness.reason}` : ""}</p><p className="text-sm">{readiness.limits.requestsToday}/{readiness.limits.dailyRequests} requests today · {readiness.limits.reservedTokensToday}/{readiness.limits.dailyTokens} reserved budget tokens · {readiness.limits.timeoutMs} ms timeout</p><p className="text-xs text-muted-foreground">{readiness.note}</p></> : <p>Loading provider diagnostics…</p>}
    {canManage && <label className="block text-sm">Provider check <select aria-label="Provider check" value={scenario} onChange={event => setScenario(event.target.value)} className="ml-2 rounded border p-2"><option value="MINIMAL">Minimal generation</option><option value="ADVISOR">Actual Advisor prompt</option><option value="TOOL_FOLLOWUP">Tool result and follow-up</option></select></label>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void load()}>Refresh diagnostics</Button>{canManage && <Button disabled={busy} onClick={() => void verify()}>Verify selected provider</Button>}</div>
    <h3 className="font-medium">Approved knowledge index</h3>
    <p className="text-xs text-muted-foreground">{knowledge?.note} Indexing uses reviewed records already stored here. Maximum 10 documents and 15 seconds per operation.</p>
    <ul className="space-y-2">{knowledge?.documents.map((doc) => <li key={doc.id} className="rounded border p-2 text-sm">{doc.title} · {doc.locale.toUpperCase()} · v{doc.version} · {doc.status} · {doc.currentChunks}{doc.truncated ? "+" : ""} current chunks{doc.reason ? ` · ${doc.reason}` : ""}</li>)}</ul>
    {knowledge?.documents.length === 0 && <p>No knowledge documents are registered.</p>}
    <div className="flex flex-wrap gap-2">{canManage && <Button disabled={busy || !knowledge?.documents.some((doc) => doc.canIndex)} onClick={() => void index()}>Index up to 10 approved revisions</Button>}<Button variant="outline" disabled={busy} onClick={() => void load()}>First page</Button><Button variant="outline" disabled={busy || !knowledge?.nextCursor} onClick={() => void load(knowledge?.nextCursor ?? "")}>Next page</Button></div>
  </section>;
}
