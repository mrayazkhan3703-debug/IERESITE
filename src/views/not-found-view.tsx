"use client";

import * as React from "react";
import { Link, navigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/components/layout/app-shell";
import { SearchBar } from "@/components/search/search-bar";

export default function NotFoundView() {
  usePageMeta({ title: "Page not found", noindex: true });

  return (
    <div className="container-page flex flex-col items-center py-24 text-center">
      <p className="num font-display text-7xl font-semibold text-brand/30">404</p>
      <h1 className="mt-4 font-display text-2xl font-semibold sm:text-3xl">This page has moved or doesn't exist</h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        The address may have changed. Try searching for what you need, or start from the homepage.
      </p>
      <div className="mt-6 w-full max-w-md">
        <SearchBar size="md" placeholder="Search properties, communities, projects…" />
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link to="/">Back to homepage</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/properties">Browse properties</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/contact">Contact us</Link>
        </Button>
      </div>
      <nav aria-label="Popular sections" className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
        {[
          { to: "/buy", label: "Buy" },
          { to: "/rent", label: "Rent" },
          { to: "/off-plan", label: "Off-plan" },
          { to: "/projects", label: "New projects" },
          { to: "/communities", label: "Communities" },
          { to: "/market", label: "Market intelligence" },
        ].map((l) => (
          <Link key={l.to} to={l.to} className="transition-ui hover:text-foreground">
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
