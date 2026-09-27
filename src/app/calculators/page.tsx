import SpaRoot from "@/components/spa-root";
import CalculatorsHubView from "@/views/calculators-hub-view";
import { criticalPageMetadata } from "@/server/seo/critical-page";

export const generateMetadata = () => criticalPageMetadata("/calculators");
export default function Page() {
  return <SpaRoot initialPath="/calculators" initialView={<CalculatorsHubView />} />;
}
