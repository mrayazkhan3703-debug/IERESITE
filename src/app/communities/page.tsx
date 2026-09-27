import View from "@/views/communities-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/communities", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
