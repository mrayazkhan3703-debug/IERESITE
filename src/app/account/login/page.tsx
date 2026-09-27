import SpaRoot from "@/components/spa-root";
import LoginView from "@/views/login-view";
import { criticalPageMetadata } from "@/server/seo/critical-page";

export const generateMetadata = () => criticalPageMetadata("/account/login");
export default function Page() {
  return <SpaRoot initialPath="/account/login" initialView={<LoginView />} />;
}
