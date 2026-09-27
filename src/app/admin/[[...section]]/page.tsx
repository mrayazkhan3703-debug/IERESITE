import PageShell from "@/components/page-shell";
import AdminView from "@/views/admin/admin-view";
import { criticalPageMetadata } from "@/server/seo/critical-page";
type Props = { params: Promise<{ section?: string[] }> };
export async function generateMetadata({ params }: Props) {
  const { section = [] } = await params;
  return criticalPageMetadata(`/admin${section.length ? `/${section.join("/")}` : ""}`);
}
export default function Page() { return <PageShell><AdminView /></PageShell>; }
