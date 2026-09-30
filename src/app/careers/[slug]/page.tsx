import View from "@/views/career-opening-view";
import { entityPage } from "@/server/seo/native-page";
const route = entityPage("/careers", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
