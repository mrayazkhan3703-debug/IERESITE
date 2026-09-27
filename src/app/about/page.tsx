import View from "@/views/about-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/about", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
