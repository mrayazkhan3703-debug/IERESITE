import type { Metadata } from "next";
import SpaRoot from "@/components/spa-root";
import HomeView from "@/views/home-view";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    languages: { en: "/", ar: "/ar", "x-default": "/" },
  },
};

export default function HomePage() {
  return <SpaRoot initialPath="/" initialView={<HomeView />} />;
}
