import View from "@/views/cms-page-view";
import { entityPage } from "@/server/seo/native-page";
const route = entityPage("/pages", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
