"use client";
import * as React from "react";
import { AgentAvatar } from "@/components/entity/agent-avatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AssignedAdvisorField({ value, onChange, advisors }: { value: string; onChange: (id: string) => void; advisors: Record<string, unknown>[] }) {
  const [query, setQuery] = React.useState("");
  const id = React.useId();
  const unavailable = Boolean(value && !advisors.some(advisor => advisor.id === value));
  const filtered = advisors.filter(advisor => advisor.id === value || [advisor.name, advisor.jobTitle, advisor.department].some(field => String(field ?? "").toLowerCase().includes(query.toLowerCase())));
  return <div className="space-y-2">
    <label htmlFor={id} className="block text-sm font-medium">Assigned advisor</label>
    <Input aria-label="Search available advisors" placeholder="Search advisor name, title or department" value={query} onChange={event => setQuery(event.target.value)} />
    <Select value={value || "none"} onValueChange={next => onChange(next === "none" ? "" : next)}>
      <SelectTrigger id={id}><SelectValue placeholder="Unassigned" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Unassigned — advisory desk</SelectItem>
        {unavailable && <SelectItem value={value} disabled>Saved advisor unavailable</SelectItem>}
        {filtered.map(advisor => <SelectItem key={String(advisor.id)} value={String(advisor.id)}><span className="flex items-center gap-2">
          <AgentAvatar name={String(advisor.name)} photoUrl={advisor.photoMediaId ? `/api/media/${String(advisor.photoMediaId)}/content` : advisor.photoUrl ? String(advisor.photoUrl) : null} className="h-8 w-8" />
          <span>{String(advisor.name)}<span className="block text-xs text-muted-foreground">{String(advisor.jobTitle ?? "")} · {String(advisor.department ?? "other")}</span></span>
        </span></SelectItem>)}
        {filtered.length === 0 && <p role="status" className="p-2 text-sm text-muted-foreground">No eligible advisors match this search.</p>}
      </SelectContent>
    </Select>
    {!value && <p className="text-xs text-muted-foreground">No advisor assigned. Public enquiries use the advisory desk.</p>}
    {unavailable && <p role="status" className="text-xs text-destructive">The saved advisor is no longer eligible. Choose an available advisor or clear the assignment.</p>}
  </div>;
}
