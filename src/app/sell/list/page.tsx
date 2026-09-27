import View from "@/views/list-property-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/sell/list", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
