import View from "@/views/guides-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/guides", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
