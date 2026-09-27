"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { RouteErrorBoundary } from "@/components/common/route-error-boundary";
import { useRoute } from "@/lib/router";

/** The server route owns view selection; this shell owns only presentation. */
export default function PageShell({ children }: { children: ReactNode }) {
  const location = useRoute();
  return (
    <AppShell>
      <RouteErrorBoundary resetKey={location.rawPath}>{children}</RouteErrorBoundary>
    </AppShell>
  );
}
