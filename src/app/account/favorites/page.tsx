import View from "@/views/account-favorites-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/account/favorites", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
