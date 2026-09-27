import { notFound } from "next/navigation";
import SpaRoot from "@/components/spa-root";
import CalculatorView from "@/views/calculator-view";
import { isCalculatorToolKey } from "@/lib/calculator-tools";
import { criticalPageMetadata } from "@/server/seo/critical-page";

type Props = { params: Promise<{ tool: string }> };
export async function generateMetadata({ params }: Props) {
  const { tool } = await params;
  return criticalPageMetadata(`/calculators/${tool}`);
}
export default async function Page({ params }: Props) {
  const { tool } = await params;
  if (!isCalculatorToolKey(tool)) notFound();
  return <SpaRoot initialPath={`/calculators/${tool}`} initialView={<CalculatorView tool={tool} />} />;
}
