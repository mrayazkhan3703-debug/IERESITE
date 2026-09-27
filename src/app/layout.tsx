import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { RouterServerSnapshotProvider, type RouteLocation } from "@/lib/router";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz"],
});

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  // Inter is variable; one continuous face retains all existing UI weights
  // without Google's discrete-weight kit URLs that pinned Turbopack cannot parse.
  weight: "variable",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Investment Experts — Dubai Real Estate Investment Platform",
    template: "%s | Investment Experts",
  },
  description:
    "Curated Dubai property inventory with investment evidence, market intelligence, investor tools and advisor-led guidance. Search apartments, villas and off-plan projects across Dubai's prime communities.",
  applicationName: "Investment Experts",
  keywords: [
    "Dubai real estate",
    "Dubai property investment",
    "off-plan Dubai",
    "Dubai apartments for sale",
    "Dubai villas",
    "property investment Dubai",
    "Dubai property market",
  ],
  authors: [{ name: "Investment Experts" }],
  openGraph: {
    title: "Investment Experts — Dubai Real Estate Investment Platform",
    description:
      "Curated Dubai property inventory with investment evidence, calculators, market intelligence and expert advisory.",
    siteName: "Investment Experts",
    type: "website",
    /* V3-19: real og:image — the Dubai-skyline hero artwork (1344×768 jpg). */
    images: [
      {
        url: "/images/brand/hero-skyline.jpg",
        width: 1344,
        height: 768,
        alt: "Dubai skyline at dusk across the water — Investment Experts",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Investment Experts",
    description: "Dubai real estate investment platform",
    images: ["/images/brand/hero-skyline.jpg"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#191817" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const locale = requestHeaders.get("x-iere-locale") === "ar" ? "ar" : "en";
  const rawPath = requestHeaders.get("x-iere-path") ?? "/";
  const routePath =
    locale === "ar" ? (rawPath === "/ar" ? "/" : rawPath.startsWith("/ar/") ? rawPath.slice(3) : rawPath) : rawPath;
  const serverLocation: RouteLocation = {
    rawPath: routePath,
    path: routePath,
    query: {},
    locale,
  };

  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} suppressHydrationWarning>
      <body
        className={`${display.variable} ${sans.variable} font-sans antialiased bg-background text-foreground`}
      >
        <RouterServerSnapshotProvider location={serverLocation}>
          {children}
          <Toaster />
          <SonnerToaster position="bottom-right" />
        </RouterServerSnapshotProvider>
      </body>
    </html>
  );
}
