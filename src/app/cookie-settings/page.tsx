import View from "@/views/cookie-settings-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/cookie-settings", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
