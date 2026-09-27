import View from "@/views/developer-detail-view";
import { entityPage } from "@/server/seo/native-page";
const route = entityPage("/developers", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
