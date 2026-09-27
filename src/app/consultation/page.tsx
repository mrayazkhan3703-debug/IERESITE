import SpaRoot from "@/components/spa-root";
import ConsultationView from "@/views/consultation-view";
import { criticalPageMetadata } from "@/server/seo/critical-page";

export const generateMetadata = () => criticalPageMetadata("/consultation");
export default function Page() {
  return <SpaRoot initialPath="/consultation" initialView={<ConsultationView />} />;
}
