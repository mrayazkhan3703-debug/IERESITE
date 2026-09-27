import View from "@/views/market-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/market", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
