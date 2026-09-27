import SpaRoot from "@/components/spa-root";
import RegisterView from "@/views/register-view";
import { criticalPageMetadata } from "@/server/seo/critical-page";

export const generateMetadata = () => criticalPageMetadata("/account/register");
export default function Page() {
  return <SpaRoot initialPath="/account/register" initialView={<RegisterView />} />;
}
