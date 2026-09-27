import View from "@/views/insights-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/insights", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
