import View from "@/views/developers-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/developers", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
