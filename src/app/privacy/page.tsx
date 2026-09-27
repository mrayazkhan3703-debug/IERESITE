import View from "@/views/privacy-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/privacy", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
