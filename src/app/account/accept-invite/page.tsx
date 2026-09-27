import PageShell from "@/components/page-shell";
import AccountTokenView from "@/views/account-token-view";
import { criticalPageMetadata } from "@/server/seo/critical-page";
export const generateMetadata = () => criticalPageMetadata("/account/accept-invite");
export default function Page() { return <PageShell><AccountTokenView mode="invite" /></PageShell>; }
