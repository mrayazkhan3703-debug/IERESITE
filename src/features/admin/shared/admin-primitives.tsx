"use client";
import * as React from "react";

export function AdminPageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return <header className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h1 className="font-display text-2xl font-semibold">{title}</h1>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>{actions}</header>;
}

export function AdminFormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section className="space-y-4 rounded-xl border border-border/70 bg-card p-4 sm:p-5"><div><h2 className="font-display text-lg font-semibold">{title}</h2>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>{children}</section>;
}

/** Protects against browser unloads; long-form editors should pair this with a discard confirmation. */
export function useUnsavedChanges(isDirty: boolean) {
  React.useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const confirmNavigation = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank") return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin === window.location.origin && destination.pathname !== window.location.pathname && !window.confirm("Discard your unsaved changes?")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", confirmNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", confirmNavigation, true);
    };
  }, [isDirty]);
}

export function confirmDiscardChanges(isDirty: boolean) {
  return !isDirty || window.confirm("Discard your unsaved changes?");
}
