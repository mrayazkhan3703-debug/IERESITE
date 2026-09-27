"use client";

import type { ReactNode } from "react";
import PageShell from "@/components/page-shell";

/** Compatibility props for previously extracted critical pages, not a router. */
export default function RootPage({ initialView }: { initialPath?: string; initialView: ReactNode }) {
  return <PageShell>{initialView}</PageShell>;
}
