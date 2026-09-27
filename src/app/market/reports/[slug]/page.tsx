import View from "@/views/market-report-view";
import { entityPage } from "@/server/seo/native-page";
const route = entityPage("/market/reports", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
