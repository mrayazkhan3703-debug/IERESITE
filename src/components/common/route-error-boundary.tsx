"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary (resilience contract).
 * Any render-phase throw inside a route view degrades to a recoverable
 * message inside the app shell (header/footer stay usable) instead of
 * unmounting the whole React tree into a blank page.
 * The boundary resets when the route changes, so navigating away
 * and back gives the view a fresh lifecycle.
 */
export class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surfaced for observability; page stays interactive.
    console.error("[route-error-boundary]", error.message, info.componentStack?.split("\n").slice(0, 4).join(" | "));
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" className="container-page flex min-h-[60vh] items-center justify-center py-16">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft">
            <AlertTriangle className="h-6 w-6 text-brand-strong" aria-hidden />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold text-ink">This view hit an unexpected error</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The rest of the site is still working. Try reloading this view, or head back to the homepage.
            If the problem repeats, our team would appreciate the details.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Button
              onClick={() => {
                this.setState({ error: null });
              }}
              className="sm:w-auto"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Retry this view
            </Button>
            <Button variant="outline" asChild>
              <Link to="/">
                <Home className="h-4 w-4" aria-hidden />
                Back to homepage
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
