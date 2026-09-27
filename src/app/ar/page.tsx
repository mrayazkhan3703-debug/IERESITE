import type { Metadata } from "next";

export { default } from "@/app/page";

export const metadata: Metadata = {
  alternates: {
    canonical: "/ar",
    languages: { en: "/", ar: "/ar", "x-default": "/" },
  },
};
