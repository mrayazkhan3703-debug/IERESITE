import View from "@/views/team-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/about/team", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
