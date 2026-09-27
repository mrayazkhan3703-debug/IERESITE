import View from "@/views/off-plan-hub-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/off-plan", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
