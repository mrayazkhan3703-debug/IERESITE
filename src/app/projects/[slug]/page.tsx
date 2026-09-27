import View from "@/views/project-detail-view";
import { entityPage } from "@/server/seo/native-page";
const route = entityPage("/projects", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
