import View from "@/views/rent-hub-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/rent", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
