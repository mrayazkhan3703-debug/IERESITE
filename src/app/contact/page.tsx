import View from "@/views/contact-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/contact", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
