import View from "@/views/search-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/properties", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
