import View from "@/views/atlas-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/atlas", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
