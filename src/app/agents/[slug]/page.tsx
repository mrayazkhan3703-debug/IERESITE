import View from "@/views/agent-detail-view";
import { entityPage } from "@/server/seo/native-page";
const route = entityPage("/agents", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
