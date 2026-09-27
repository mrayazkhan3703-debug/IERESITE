import View from "@/views/article-view";
import { entityPage } from "@/server/seo/native-page";
const route = entityPage("/insights", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
