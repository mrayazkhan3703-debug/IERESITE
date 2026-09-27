import SpaRoot from "@/components/spa-root";
import BuyHubView from "@/views/buy-hub-view";
import { criticalPageMetadata } from "@/server/seo/critical-page";

export const generateMetadata = () => criticalPageMetadata("/buy");
export default function Page() {
  return <SpaRoot initialPath="/buy" initialView={<BuyHubView />} />;
}
