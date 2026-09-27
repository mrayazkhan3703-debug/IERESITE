import View from "@/views/account-portfolio-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/account/portfolio", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
