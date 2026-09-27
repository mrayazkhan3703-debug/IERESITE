/** Reuse installed Leaflet artwork as hashed same-origin build assets. */
import retina from "leaflet/dist/images/marker-icon-2x.png";
import icon from "leaflet/dist/images/marker-icon.png";
import shadow from "leaflet/dist/images/marker-shadow.png";

export const LEAFLET_DEFAULT_ICONS = {
  iconRetinaUrl: retina.src,
  iconUrl: icon.src,
  shadowUrl: shadow.src,
} as const;
