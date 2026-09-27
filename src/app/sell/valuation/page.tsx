import View from "@/views/valuation-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/sell/valuation", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
