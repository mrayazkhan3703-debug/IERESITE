import View from "@/views/invest-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/invest", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
