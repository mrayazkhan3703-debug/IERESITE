import View from "@/views/opportunities-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/invest/opportunities", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
