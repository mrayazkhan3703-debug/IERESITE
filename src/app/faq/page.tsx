import SpaRoot from "@/components/spa-root";
import FaqView from "@/views/faq-view";
import { criticalPageMetadata } from "@/server/seo/critical-page";

export const generateMetadata = () => criticalPageMetadata("/faq");
export default function Page() {
  return <SpaRoot initialPath="/faq" initialView={<FaqView />} />;
}
