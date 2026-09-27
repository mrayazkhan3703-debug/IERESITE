import View from "@/views/international-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/international", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
