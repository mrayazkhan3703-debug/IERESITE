import View from "@/views/account-preferences-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/account/preferences", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
