import View from "@/views/projects-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/projects", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
