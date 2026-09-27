import View from "@/views/advisor-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/advisor", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
