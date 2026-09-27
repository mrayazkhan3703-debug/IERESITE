import View from "@/views/transactions-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/market/transactions", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
