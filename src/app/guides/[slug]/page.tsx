import View from "@/views/guide-view";
import { entityPage } from "@/server/seo/native-page";
const route = entityPage("/guides", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
