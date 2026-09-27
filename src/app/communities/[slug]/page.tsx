import View from "@/views/community-detail-view";
import { entityPage } from "@/server/seo/native-page";
const route = entityPage("/communities", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
