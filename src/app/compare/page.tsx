import View from "@/views/compare-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/compare", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
