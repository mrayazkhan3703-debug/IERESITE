import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="container-page flex min-h-screen flex-col items-center justify-center py-20 text-center">
      <p className="kicker mb-3">404</p>
      <h1 className="type-h1">Page not found</h1>
      <p className="mt-4 max-w-lg text-muted-foreground">
        The page may have moved, or the address may be incorrect.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <a className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground" href="/">
          Return home
        </a>
        <a className="rounded-md border border-border px-5 py-2.5 text-sm font-medium" href="/properties">
          Browse properties
        </a>
      </div>
    </main>
  );
}
