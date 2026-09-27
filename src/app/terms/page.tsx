import View from "@/views/terms-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/terms", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
