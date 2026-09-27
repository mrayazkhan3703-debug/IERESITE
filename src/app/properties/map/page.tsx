import View from "@/views/map-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/properties/map", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
