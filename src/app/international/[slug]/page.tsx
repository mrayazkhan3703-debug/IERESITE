import View from "@/views/international-guide-view";
import { entityPage } from "@/server/seo/native-page";
const route = entityPage("/international", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
