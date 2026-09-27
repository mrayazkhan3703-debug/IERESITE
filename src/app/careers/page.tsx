import View from "@/views/careers-view";
import { staticPage } from "@/server/seo/native-page";
const route = staticPage("/careers", View);
export const generateMetadata = route.generateMetadata;
export default route.Page;
