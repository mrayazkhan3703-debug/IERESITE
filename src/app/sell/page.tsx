import View from "@/views/sell-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/sell", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
