import type { MetadataRoute } from "next";
import { robotsForEnvironment } from "@/server/seo/staging-robots";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return robotsForEnvironment(process.env.APP_ENV, process.env.APP_URL ?? "http://localhost:3000");
}
