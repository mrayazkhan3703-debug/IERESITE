import View from "@/views/account-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/account", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
