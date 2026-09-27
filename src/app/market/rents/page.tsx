import View from "@/views/rents-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/market/rents", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
