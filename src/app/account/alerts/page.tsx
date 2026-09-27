import View from "@/views/account-alerts-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/account/alerts", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
