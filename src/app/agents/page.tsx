import View from "@/views/agents-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/agents", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
