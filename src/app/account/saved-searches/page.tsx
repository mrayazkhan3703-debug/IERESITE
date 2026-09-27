import View from "@/views/account-saved-searches-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/account/saved-searches", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
