/**
 * Development seed — CLEARLY LABELED DEMO FIXTURE DATA (ADR-010).
 * Real public Dubai geography/developers; fictional listings/prices/projects
 * marked isDemoData=true, sourceType=DEMO_SEED. Replace via ingestion pipeline
 * (docs/DEPLOYMENT_RUNBOOK.md §2) when the production feed is available.
 *
 * Run: bun run seed   (idempotent — skips when markers exist)
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";
import { TEAM_MEMBERS, ADVISORY_DESK } from "./team-data";
import { ROLE_PERMISSION_MANIFEST } from "../src/server/authz-policy";
import { rebuildIndex } from "../src/server/search/service";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

const AED = (units: number) => BigInt(Math.round(units * 100));
const now = () => new Date();
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400_000);

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

const AMENITIES: { key: string; name: string; category: string; icon: string }[] = [
  { key: "POOL", name: "Swimming Pool", category: "BUILDING", icon: "waves" },
  { key: "GYM", name: "Fully Equipped Gym", category: "BUILDING", icon: "dumbbell" },
  { key: "BEACH_ACCESS", name: "Private Beach Access", category: "OUTDOOR", icon: "umbrella" },
  { key: "CONCIERGE", name: "24h Concierge", category: "SERVICE", icon: "bell-ring" },
  { key: "PARKING", name: "Covered Parking", category: "BUILDING", icon: "car-front" },
  { key: "SECURITY", name: "24h Security", category: "SERVICE", icon: "shield-check" },
  { key: "KIDS_PLAY", name: "Children's Play Area", category: "OUTDOOR", icon: "baby" },
  { key: "BBQ_AREA", name: "BBQ Area", category: "OUTDOOR", icon: "flame" },
  { key: "JACUZZI", name: "Jacuzzi & Spa", category: "BUILDING", icon: "bath" },
  { key: "SMART_HOME", name: "Smart Home System", category: "UNIT", icon: "house-plug" },
  { key: "MAID_ROOM", name: "Maid's Room", category: "UNIT", icon: "door-closed" },
  { key: "STUDY", name: "Study / Office", category: "UNIT", icon: "book-open" },
  { key: "BALCONY", name: "Private Balcony", category: "UNIT", icon: "square" },
  { key: "PET_FRIENDLY", name: "Pet Friendly", category: "SERVICE", icon: "dog" },
  { key: "WALK_TO_METRO", name: "Walking Distance to Metro", category: "SERVICE", icon: "train-front" },
  { key: "GOLF_VIEW", name: "Golf Course View", category: "OUTDOOR", icon: "flag" },
];

interface CommunitySeed {
  slug: string; name: string; areaType: string; lat: number; lng: number;
  summary: string; tags: string[]; avgPricePerSqft?: number;
  transport: { type: string; name: string; distance: string }[];
  schools: { name: string; rating: string }[];
  image: string;
  radius?: number;
}

const COMMUNITIES: CommunitySeed[] = [
  {
    slug: "dubai-marina", name: "Dubai Marina", areaType: "WATERFRONT", lat: 25.0805, lng: 55.1403,
    summary: "The world's largest man-made marina — waterfront towers, promenade living and strong rental demand.",
    tags: ["Waterfront", "Metro access", "Nightlife", "High rental demand"],
    avgPricePerSqft: 1750,
    transport: [
      { type: "METRO", name: "DMCC / Marina Station", distance: "5–12 min walk" },
      { type: "TRAM", name: "Dubai Marina Tram", distance: "Along promenade" },
    ],
    schools: [{ name: "Emirates International School Meadows", rating: "Very Good (KHDA)" }],
    image: "/images/communities/dubai-marina.jpg",
  },
  {
    slug: "downtown-dubai", name: "Downtown Dubai", areaType: "BUSINESS", lat: 25.1972, lng: 55.2744,
    summary: "The city's iconic centre — Burj Khalifa, Dubai Mall and the Boulevard, with premium short-stay appeal.",
    tags: ["Iconic landmark", "Walkable", "Investment hotspot", "Short-stay demand"],
    avgPricePerSqft: 2200,
    transport: [{ type: "METRO", name: "Burj Khalifa / Dubai Mall Station", distance: "8–15 min walk" }],
    schools: [{ name: "Dubai British School Downtown", rating: "Not rated (new)" }],
    image: "/images/communities/downtown-dubai.jpg",
  },
  {
    slug: "palm-jumeirah", name: "Palm Jumeirah", areaType: "ISLAND", lat: 25.1124, lng: 55.139,
    summary: "Dubai's signature island — beachfront villas and apartment hotels with the capital's highest trophy-value addresses.",
    tags: ["Beachfront", "Luxury", "Trophy assets", "Tourism"],
    avgPricePerSqft: 3100,
    transport: [{ type: "MONORAIL", name: "Palm Monorail", distance: "Gateway stations" }],
    schools: [{ name: "Dubai College (nearby Al Sufouh)", rating: "Outstanding (KHDA)" }],
    image: "/images/communities/palm-jumeirah.jpg",
  },
  {
    slug: "business-bay", name: "Business Bay", areaType: "BUSINESS", lat: 25.1857, lng: 55.2758,
    summary: "Canal-side high-rise district minutes from Downtown — investor favourite for serviced and branded residences.",
    tags: ["Canal views", "Branded residences", "Business hub"],
    avgPricePerSqft: 1600,
    transport: [{ type: "METRO", name: "Business Bay Station", distance: "6–14 min walk" }],
    schools: [],
    image: "/images/communities/business-bay.jpg",
  },
  {
    slug: "jumeirah-village-circle", name: "Jumeirah Village Circle", areaType: "SUBURBAN", lat: 25.0596, lng: 55.2098,
    summary: "Value-driven circular community with townhouses and mid-rise apartments — consistently among Dubai's most rented areas.",
    tags: ["Value", "Family", "High yields", "Investor favourite"],
    avgPricePerSqft: 980,
    transport: [{ type: "BUS", name: "F30 / F31 feeder", distance: "Community loop" }],
    schools: [{ name: "JSS Private School", rating: "Good (KHDA)" }],
    image: "/images/communities/jvc.jpg",
  },
  {
    slug: "arabian-ranches", name: "Arabian Ranches", areaType: "RESIDENTIAL", lat: 25.0527, lng: 55.2703,
    summary: "Established gated villa community around an equestrian and golf lifestyle — family-oriented, low density.",
    tags: ["Villas", "Golf", "Family", "Gated"],
    avgPricePerSqft: 1250,
    transport: [{ type: "BUS", name: "F32 feeder", distance: "Community access" }],
    schools: [{ name: "Jumeirah English Speaking School (JESS)", rating: "Outstanding (KHDA)" }],
    image: "/images/communities/arabian-ranches.jpg",
  },
  {
    slug: "emirates-hills", name: "Emirates Hills", areaType: "RESIDENTIAL", lat: 25.0689, lng: 55.1616,
    summary: "Dubai's premier mansion district around the Montgomerie golf course — ultra-prime plots and bespoke villas.",
    tags: ["Ultra-prime", "Golf", "Mansions", "Privacy"],
    avgPricePerSqft: 2400,
    transport: [],
    schools: [{ name: "Dubai International Academy Emirates Hills", rating: "Very Good (KHDA)" }],
    image: "/images/communities/emirates-hills.jpg",
  },
  {
    slug: "dubai-hills-estate", name: "Dubai Hills Estate", areaType: "RESIDENTIAL", lat: 25.1106, lng: 55.2452,
    summary: "Master-planned green estate with a championship golf course, mall and park — the emirate's template for modern family living.",
    tags: ["Master-planned", "Golf", "Park", "Family"],
    avgPricePerSqft: 1450,
    transport: [{ type: "METRO", name: "Creek / future stations", distance: "Bus feeder" }],
    schools: [{ name: "GEMS International School Al Khail", rating: "Very Good (KHDA)" }],
    image: "/images/communities/dubai-hills-estate.jpg",
  },
];

const DEVELOPERS = [
  { slug: "emaar-properties", name: "Emaar Properties", summary: "Dubai's flagship master developer — Burj Khalifa, Downtown and Dubai Creek Harbour.", verificationStatus: "PUBLIC_RECORDS" },
  { slug: "damac-properties", name: "DAMAC Properties", summary: "Luxury branded residences and golf communities across Dubai.", verificationStatus: "PUBLIC_RECORDS" },
  { slug: "sobha-realty", name: "Sobha Realty", summary: "Backward-integrated developer known for build quality — Sobha Hartland.", verificationStatus: "PUBLIC_RECORDS" },
  { slug: "meraas", name: "Meraas", summary: "Place-maker behind City Walk, Bluewaters and Jumeirah Bay Island.", verificationStatus: "PUBLIC_RECORDS" },
  { slug: "nakheel", name: "Nakheel", summary: "Master developer of Dubai's iconic islands and waterfront communities.", verificationStatus: "PUBLIC_RECORDS" },
  { slug: "azizi-developments", name: "Azizi Developments", summary: "High-volume waterfront and affordable-luxury developer in Dubai South and Marina.", verificationStatus: "PUBLIC_RECORDS" },
  { slug: "binghatti", name: "Binghatti", summary: "Architecture-led developer known for distinctive facade design.", verificationStatus: "PUBLIC_RECORDS" },
];

/* Projects: FICTIONAL (demo) names attached to real developer/community frames */
const PROJECTS = [
  { slug: "azure-marina-residences", name: "Azure Marina Residences", developer: "azizi-developments", community: "dubai-marina", status: "OFF_PLAN", lat: 25.081, lng: 55.138, handover: daysFromNow(560), completion: 25, startingPrice: AED(1_450_000), tagline: "Waterfront living reimagined", image: "/images/projects/tower-render-1.jpg", units: 420, type: "RESIDENTIAL" },
  { slug: "meridian-downtown-towers", name: "Meridian Downtown Towers", developer: "emaar-properties", community: "downtown-dubai", status: "UNDER_CONSTRUCTION", lat: 25.1965, lng: 55.2755, handover: daysFromNow(400), completion: 62, startingPrice: AED(2_100_000), tagline: "Two towers. One address.", image: "/images/projects/tower-render-2.jpg", units: 780, type: "RESIDENTIAL" },
  { slug: "lagoon-gate-villas", name: "Lagoon Gate Villas", developer: "damac-properties", community: "jumeirah-village-circle", status: "OFF_PLAN", lat: 25.0585, lng: 55.2125, handover: daysFromNow(730), completion: 10, startingPrice: AED(2_850_000), tagline: "Boutique lagoon villas", image: "/images/projects/villas-render.jpg", units: 88, type: "RESIDENTIAL" },
  { slug: "the-quay-bay", name: "The Quay Bay", developer: "meraas", community: "business-bay", status: "OFF_PLAN", lat: 25.1885, lng: 55.272, handover: daysFromNow(650), completion: 18, startingPrice: AED(1_280_000), tagline: "Canal-side branded living", image: "/images/projects/waterfront-render.jpg", units: 540, type: "MIXED_USE" },
  { slug: "crescent-sky-palm", name: "Crescent Sky (Palm)", developer: "nakheel", community: "palm-jumeirah", status: "OFF_PLAN", lat: 25.1124, lng: 55.1335, handover: daysFromNow(820), completion: 5, startingPrice: AED(4_200_000), tagline: "Sky residences on the crescent", image: "/images/projects/tower-render-3.jpg", units: 220, type: "RESIDENTIAL" },
  { slug: "verdant-hills-collection", name: "Verdant Hills Collection", developer: "emaar-properties", community: "dubai-hills-estate", status: "UNDER_CONSTRUCTION", lat: 25.1098, lng: 55.2425, handover: daysFromNow(300), completion: 78, startingPrice: AED(3_650_000), tagline: "Golf-side family villas", image: "/images/projects/hills-development.jpg", units: 150, type: "RESIDENTIAL" },
];

const PAYMENT_PLAN_STANDARD = [
  { label: "Booking deposit", percent: 10, dueOffsetMonths: 0 },
  { label: "Installment (construction)", percent: 10, dueOffsetMonths: 6 },
  { label: "Installment (construction)", percent: 10, dueOffsetMonths: 12 },
  { label: "Installment (construction)", percent: 10, dueOffsetMonths: 18 },
  { label: "Installment (construction)", percent: 10, dueOffsetMonths: 24 },
  { label: "On handover", percent: 40, dueOffsetMonths: 36 },
  { label: "Post-handover", percent: 10, dueOffsetMonths: 48 },
];

const AGENTS = [
  { slug: ADVISORY_DESK.slug, name: ADVISORY_DESK.name, jobTitle: ADVISORY_DESK.jobTitle, phone: ADVISORY_DESK.phoneE164, whatsapp: ADVISORY_DESK.whatsappE164, phoneDisplay: ADVISORY_DESK.phoneDisplay, department: ADVISORY_DESK.department, publicAdvisor: ADVISORY_DESK.publicAdvisor, photoUrl: ADVISORY_DESK.photoUrl, weight: ADVISORY_DESK.sortWeight },
  ...TEAM_MEMBERS.map((m) => ({ slug: m.slug, name: m.name, jobTitle: m.jobTitle, phone: m.phoneE164, whatsapp: m.whatsappE164, phoneDisplay: m.phoneDisplay, department: m.department, publicAdvisor: m.publicAdvisor, photoUrl: m.photoUrl, weight: 26 - m.order })),
] as { slug: string; name: string; jobTitle: string; phone: string | null; whatsapp: string | null; phoneDisplay: string | null; department: string; publicAdvisor: boolean; photoUrl: string; weight: number }[];

/* Properties: FICTIONAL listings (demo) */
interface PropSeed {
  slug: string; title: string; community: string; project?: string; developer?: string;
  type: string; beds: number; baths: number; area: number; price: number;
  listingType: "SALE" | "RENT"; offPlan?: boolean; view?: string; furnishing?: string;
  featured?: boolean; exclusive?: boolean; availability?: string; agent: string;
  images: string[]; handover?: string; highlights: string[]; description: string;
  amenities: string[];
}

const PROPERTIES: PropSeed[] = [
  // Dubai Marina
  { slug: "marina-2br-sea-view-azure-12", title: "2-Bed Sea-View Residence, Azure Marina", community: "dubai-marina", project: "azure-marina-residences", developer: "azizi-developments", type: "APARTMENT", beds: 2, baths: 2, area: 1210, price: 2_150_000, listingType: "SALE", offPlan: true, view: "SEA", furnishing: "UNFURNISHED", featured: true, exclusive: true, agent: "advisory-desk", images: ["/images/properties/apartment-marina-living.jpg", "/images/properties/apartment-marina-bedroom.jpg", "/images/properties/apartment-beach-living.jpg"], handover: "Q4 2027", highlights: ["Direct sea view from living area and master bedroom", "Corner unit with wrap-around glazing", "10% booking, 40% on handover payment plan"], description: "A corner two-bedroom residence on the upper floors of Azure Marina Residences with unobstructed sea views over the Gulf. Open-plan living space flows to a wrap-around balcony; kitchen is fitted with premium appliances. Off-plan purchase with a developer payment plan (see Payment Plan tab for the schedule and verification status).", amenities: ["POOL", "GYM", "CONCIERGE", "PARKING", "SECURITY", "BALCONY", "SMART_HOME"] },
  { slug: "marina-1br-investor-unit-bay-view", title: "1-Bed Investor Unit with Marina View", community: "dubai-marina", type: "APARTMENT", beds: 1, baths: 1, area: 740, price: 1_380_000, listingType: "SALE", view: "MARINA", furnishing: "FURNISHED", agent: "advisory-desk", images: ["/images/properties/apartment-marina-bedroom.jpg", "/images/properties/apartment-marina-living.jpg"], highlights: ["Furnished and tenanted — rental history available on request", "Walking distance to metro", "Low service charges for the area"], description: "Compact one-bedroom unit on a high floor with views across the marina. Currently furnished and tenant-occupied — income from day one for investors, or vacant possession on completion of the notice period. Building amenities include pool, gym and concierge.", amenities: ["POOL", "GYM", "CONCIERGE", "PARKING", "SECURITY", "WALK_TO_METRO"] },
  { slug: "marina-studio-short-stay-ready", title: "Studio — Short-Stay Ready Tower", community: "dubai-marina", type: "STUDIO", beds: 0, baths: 1, area: 460, price: 92_000, listingType: "RENT", furnishing: "FURNISHED", agent: "advisory-desk", images: ["/images/properties/apartment-marina-living.jpg"], highlights: ["Hotel-grade furnishing package", "Licensed for short-stay operator", "Promenade location"], description: "Turnkey studio in a tower operated with short-stay licensing. Fully furnished, balcony, and direct promenade access. Ideal for a tenant wanting flexibility or an operator lease.", amenities: ["POOL", "GYM", "CONCIERGE", "SECURITY", "BALCONY"] },
  { slug: "marina-3br-penthouse-terrace", title: "3-Bed Duplex Penthouse with Private Terrace", community: "dubai-marina", type: "PENTHOUSE", beds: 3, baths: 4, area: 3480, price: 11_900_000, listingType: "SALE", view: "SEA", furnishing: "SEMI_FURNISHED", featured: true, agent: "advisory-desk", images: ["/images/properties/penthouse-terrace.jpg", "/images/properties/apartment-marina-living.jpg", "/images/properties/apartment-marina-bedroom.jpg"], highlights: ["Duplex with 90 sqm private rooftop terrace", "Panoramic sea and skyline views", "Private lift lobby and maid's room"], description: "A duplex penthouse crowning one of the Marina's established towers. The upper level opens to a private terrace with jacuzzi and skyline views; the lower level hosts a generous reception, closed kitchen and en-suite bedrooms. Private lift lobby, two parking bays and maid's room.", amenities: ["POOL", "GYM", "JACUZZI", "CONCIERGE", "PARKING", "SECURITY", "MAID_ROOM", "STUDY", "BALCONY"] },

  // Downtown Dubai
  { slug: "downtown-2br-boulevard-view-meridian", title: "2-Bed Boulevard-View Residence, Meridian Towers", community: "downtown-dubai", project: "meridian-downtown-towers", developer: "emaar-properties", type: "APARTMENT", beds: 2, baths: 2, area: 1350, price: 3_050_000, listingType: "SALE", offPlan: true, view: "SKYLINE", furnishing: "UNFURNISHED", featured: true, agent: "advisory-desk", images: ["/images/properties/apartment-downtown-interior.jpg", "/images/properties/apartment-bay-interior.jpg"], handover: "Q2 2027", highlights: ["Boulevard and partial fountain views", "Handover Q2 2027 (developer schedule, under verification)", "Walk to Dubai Mall"], description: "Off-plan two-bedroom residence in the second Meridian tower. South-east aspect overlooks the Boulevard with partial fountain views. Payment plan available; completion currently scheduled by the developer for Q2 2027 — see verification status in the Payment Plan tab.", amenities: ["POOL", "GYM", "CONCIERGE", "PARKING", "SECURITY", "BALCONY", "KIDS_PLAY"] },
  { slug: "downtown-1br-fountain-view", title: "1-Bed Fountain View Apartment", community: "downtown-dubai", type: "APARTMENT", beds: 1, baths: 2, area: 920, price: 2_480_000, listingType: "SALE", view: "SKYLINE", furnishing: "FURNISHED", agent: "advisory-desk", images: ["/images/properties/apartment-downtown-interior.jpg"], highlights: ["Direct fountain-facing balcony", "Furnished to a high standard", "Strong short-stay performance history"], description: "One-bedroom residence with the Downtown signature fountain view. Furnished throughout with a contemporary palette; balcony sized for outdoor dining. The building offers concierge, gym and pool deck.", amenities: ["POOL", "GYM", "CONCIERGE", "PARKING", "SECURITY", "BALCONY"] },
  { slug: "downtown-3br-burj-view-family", title: "3-Bed Burj View Family Residence", community: "downtown-dubai", type: "APARTMENT", beds: 3, baths: 3, area: 2100, price: 5_600_000, listingType: "SALE", view: "SKYLINE", furnishing: "UNFURNISHED", agent: "advisory-desk", images: ["/images/properties/apartment-downtown-interior.jpg", "/images/properties/apartment-bay-interior.jpg"], highlights: ["Full Burj Khalifa aspect", "Maid's room and study", "Two parking bays"], description: "A three-bedroom family residence with a full Burj aspect from the reception and master suite. Layout includes maid's room, separate study and a large kitchen-diner. Two parking bays in the podium.", amenities: ["POOL", "GYM", "CONCIERGE", "PARKING", "SECURITY", "MAID_ROOM", "STUDY", "BALCONY"] },

  // Palm Jumeirah
  { slug: "palm-signature-villa-lagoon-front", title: "Signature Lagoon-Front Villa", community: "palm-jumeirah", type: "VILLA", beds: 5, baths: 6, area: 5600, price: 28_500_000, listingType: "SALE", view: "SEA", featured: true, exclusive: true, agent: "advisory-desk", images: ["/images/properties/villa-palm-exterior.jpg", "/images/properties/villa-palm-pool.jpg"], highlights: ["Private beach and infinity pool", "Contemporary architecture with full-height glazing", "Staff quarters and 4-car garage"], description: "A signature five-bedroom villa on a lagoon-front plot. The plan opens through full-height glazing to a deck, infinity pool and private beach access. Interior specification includes staff quarters, show kitchen and working kitchen, and a submerged lounge overlooking the pool.", amenities: ["BEACH_ACCESS", "POOL", "JACUZZI", "GYM", "PARKING", "SECURITY", "SMART_HOME", "MAID_ROOM", "BBQ_AREA"] },
  { slug: "palm-garden-villa-family", title: "Garden Villa with Private Pool", community: "palm-jumeirah", type: "VILLA", beds: 4, baths: 5, area: 4200, price: 16_900_000, listingType: "SALE", view: "SEA", agent: "advisory-desk", images: ["/images/properties/villa-palm-pool.jpg", "/images/properties/villa-palm-exterior.jpg"], highlights: ["Private pool and landscaped garden", "Frond location with sea outlook", "Extended and upgraded interior"], description: "Four-bedroom garden villa on a mid-frond plot. Extended living space with an upgraded kitchen and a shaded outdoor entertaining area around the private pool. Covered parking for three vehicles.", amenities: ["POOL", "PARKING", "SECURITY", "MAID_ROOM", "BBQ_AREA", "PET_FRIENDLY"] },
  { slug: "palm-crescent-sky-2br-offplan", title: "2-Bed Sky Residence, Crescent Sky (Palm)", community: "palm-jumeirah", project: "crescent-sky-palm", developer: "nakheel", type: "APARTMENT", beds: 2, baths: 3, area: 1580, price: 5_950_000, listingType: "SALE", offPlan: true, view: "SEA", furnishing: "FURNISHED", agent: "advisory-desk", images: ["/images/projects/tower-render-3.jpg", "/images/properties/apartment-beach-living.jpg"], handover: "Q1 2028", highlights: ["Furnished specification included", "Sky-lounge and private beach club", "Early-stage payment plan"], description: "Off-plan two-bedroom sky residence on the Palm crescent. The developer's furnished specification, access to a residents' beach club and sky lounge are included. Payment plan spans construction and post-handover; verification status shown in the Payment Plan tab.", amenities: ["BEACH_ACCESS", "POOL", "GYM", "CONCIERGE", "PARKING", "SECURITY", "BALCONY", "SMART_HOME"] },

  // Business Bay
  { slug: "business-bay-1br-canal-view-quay", title: "1-Bed Canal View, The Quay Bay", community: "business-bay", project: "the-quay-bay", developer: "meraas", type: "APARTMENT", beds: 1, baths: 1, area: 680, price: 1_520_000, listingType: "SALE", offPlan: true, view: "SEA", furnishing: "FURNISHED", agent: "advisory-desk", images: ["/images/properties/apartment-bay-interior.jpg", "/images/projects/waterfront-render.jpg"], handover: "Q3 2027", highlights: ["Branded-interiors package included", "Canal promenade at doorstep", "10% down payment plan"], description: "One-bedroom canal-facing residence in The Quay Bay. Branded interiors package and white-goods included; the tower fronts the canal promenade with F&B at ground level. Off-plan payment plan available.", amenities: ["POOL", "GYM", "CONCIERGE", "PARKING", "SECURITY", "BALCONY", "SMART_HOME"] },
  { slug: "business-bay-2br-executive-unit", title: "2-Bed Executive Unit, Canal View", community: "business-bay", type: "APARTMENT", beds: 2, baths: 2, area: 1120, price: 150_000, listingType: "RENT", furnishing: "FURNISHED", agent: "advisory-desk", images: ["/images/properties/apartment-bay-interior.jpg"], highlights: ["Furnished executive standard", "Chiller free", "Walk to metro"], description: "Furnished two-bedroom unit on a high floor with canal views, offered on a single annual cheque basis (illustrative terms). Building amenities include pool, gym and concierge.", amenities: ["POOL", "GYM", "CONCIERGE", "PARKING", "SECURITY", "WALK_TO_METRO"] },

  // JVC
  { slug: "jvc-1br-affordable-investor-unit", title: "1-Bed Investor Unit, JVC", community: "jumeirah-village-circle", type: "APARTMENT", beds: 1, baths: 1, area: 720, price: 780_000, listingType: "SALE", furnishing: "UNFURNISHED", featured: true, agent: "advisory-desk", images: ["/images/properties/apartment-jvc-interior.jpg"], highlights: ["High-yield entry price point", "Retail at podium", "Community park facing"], description: "Entry-level one-bedroom unit facing the community park. Unfurnished with fitted kitchen; retail on the podium level. A frequently rented unit type in one of Dubai's most rented communities.", amenities: ["POOL", "GYM", "PARKING", "SECURITY", "KIDS_PLAY", "BALCONY"] },
  { slug: "jvc-lagoon-gate-3br-townhouse", title: "3-Bed Lagoon-Front Townhouse, Lagoon Gate", community: "jumeirah-village-circle", project: "lagoon-gate-villas", developer: "damac-properties", type: "TOWNHOUSE", beds: 3, baths: 4, area: 1890, price: 2_950_000, listingType: "SALE", offPlan: true, furnishing: "UNFURNISHED", agent: "advisory-desk", images: ["/images/projects/villas-render.jpg", "/images/properties/townhouse-exterior.jpg"], handover: "Q4 2027", highlights: ["Lagoon-front plot", "Backyard and roof terrace", "10/10/10/10/40/10 plan"], description: "Three-bedroom lagoon-front townhouse in the boutique Lagoon Gate collection. Private backyard and roof terrace; lagoon beach club for residents. Off-plan payment plan across construction and post-handover.", amenities: ["POOL", "BEACH_ACCESS", "PARKING", "SECURITY", "BBQ_AREA", "KIDS_PLAY", "SMART_HOME"] },
  { slug: "jvc-2br-rental-family", title: "2-Bed Family Rental, JVC", community: "jumeirah-village-circle", type: "APARTMENT", beds: 2, baths: 2, area: 1050, price: 96_000, listingType: "RENT", furnishing: "UNFURNISHED", agent: "advisory-desk", images: ["/images/properties/apartment-jvc-interior.jpg"], highlights: ["Park-facing aspect", "Near school bus routes", "Two cheques accepted (illustrative terms)"], description: "Two-bedroom park-facing apartment for families. Close to school bus routes and community retail. Building pool and gym.", amenities: ["POOL", "GYM", "PARKING", "SECURITY", "KIDS_PLAY", "PET_FRIENDLY"] },

  // Arabian Ranches
  { slug: "ranches-4br-family-villa", title: "4-Bed Family Villa, Arabian Ranches", community: "arabian-ranches", type: "VILLA", beds: 4, baths: 4, area: 3600, price: 4_350_000, listingType: "SALE", view: "GOLF", furnishing: "UNFURNISHED", featured: true, agent: "advisory-desk", images: ["/images/properties/villa-ranches-exterior.jpg", "/images/properties/townhouse-exterior.jpg"], highlights: ["Golf-course facing backyard", "Upgraded kitchen and landscaped garden", "Walking distance to JESS school"], description: "Four-bedroom villa on a golf-facing plot in Arabian Ranches. Upgraded kitchen, landscaped backyard with pergola, and maid's room. Walking distance to JESS and the community centre.", amenities: ["PARKING", "SECURITY", "MAID_ROOM", "BBQ_AREA", "GOLF_VIEW", "PET_FRIENDLY", "KIDS_PLAY"] },
  { slug: "ranches-3br-garden-townhouse", title: "3-Bed Garden Townhouse, Arabian Ranches", community: "arabian-ranches", type: "TOWNHOUSE", beds: 3, baths: 3, area: 2100, price: 2_600_000, listingType: "SALE", furnishing: "UNFURNISHED", agent: "advisory-desk", images: ["/images/properties/townhouse-exterior.jpg"], highlights: ["End-unit with extra garden", "Quiet cul-de-sac", "Maid's room"], description: "End-unit three-bedroom townhouse with an extended private garden on a quiet cul-de-sac. Maid's room and covered parking for two.", amenities: ["PARKING", "SECURITY", "MAID_ROOM", "PET_FRIENDLY", "KIDS_PLAY"] },

  // Emirates Hills
  { slug: "emirates-hills-contemporary-mansion", title: "Contemporary Mansion, Golf Frontage", community: "emirates-hills", type: "VILLA", beds: 6, baths: 7, area: 9200, price: 52_000_000, listingType: "SALE", view: "GOLF", exclusive: true, agent: "advisory-desk", images: ["/images/properties/villa-hills-exterior.jpg", "/images/properties/villa-palm-pool.jpg"], highlights: ["Double-plot golf frontage", "Wellness wing: pool, gym, spa", "Staff accommodation and 6-car garage"], description: "A bespoke six-bedroom mansion on a double plot with direct golf frontage in Emirates Hills. Wellness wing with pool, gym and treatment rooms; cinema, show kitchen and staff accommodation. Six-car garage.", amenities: ["POOL", "JACUZZI", "GYM", "PARKING", "SECURITY", "SMART_HOME", "MAID_ROOM", "STUDY", "BBQ_AREA", "GOLF_VIEW"] },

  // Dubai Hills
  { slug: "hills-4br-verdant-villa", title: "4-Bed Golf-Side Villa, Verdant Hills", community: "dubai-hills-estate", project: "verdant-hills-collection", developer: "emaar-properties", type: "VILLA", beds: 4, baths: 5, area: 3900, price: 4_950_000, listingType: "SALE", offPlan: true, view: "GOLF", furnishing: "UNFURNISHED", featured: true, agent: "advisory-desk", images: ["/images/projects/hills-development.jpg", "/images/properties/villa-ranches-exterior.jpg"], handover: "Q2 2026", highlights: ["Golf-side plot", "Handover Q2 2026 (developer schedule)", "Emaar build specification"], description: "Off-plan four-bedroom golf-side villa in the Verdant Hills collection. Corner plot with golf aspect; Emaar specification includes landscaped front and back gardens. Completion currently scheduled Q2 2026 by the developer — see verification status.", amenities: ["POOL", "PARKING", "SECURITY", "MAID_ROOM", "SMART_HOME", "KIDS_PLAY", "GOLF_VIEW"] },
  { slug: "hills-2br-park-apartment", title: "2-Bed Park View Apartment, Dubai Hills", community: "dubai-hills-estate", type: "APARTMENT", beds: 2, baths: 2, area: 1180, price: 1_980_000, listingType: "SALE", view: "PARK", furnishing: "UNFURNISHED", agent: "advisory-desk", images: ["/images/properties/apartment-jvc-interior.jpg", "/images/properties/apartment-downtown-interior.jpg"], highlights: ["Central park view", "Walk to mall and school", "Low-density building"], description: "Two-bedroom apartment overlooking the central park in Dubai Hills Estate. Walkable to the mall and GEMS school; low-density building with pool and gym.", amenities: ["POOL", "GYM", "PARKING", "SECURITY", "BALCONY", "KIDS_PLAY", "WALK_TO_METRO"] },
  { slug: "hills-5br-rental-villa", title: "5-Bed Villa for Rent, Dubai Hills", community: "dubai-hills-estate", type: "VILLA", beds: 5, baths: 6, area: 4800, price: 480_000, listingType: "RENT", view: "PARK", furnishing: "FURNISHED", agent: "advisory-desk", images: ["/images/properties/villa-ranches-exterior.jpg"], highlights: ["Furnished family villa", "Private pool", "Steps from park"], description: "Furnished five-bedroom villa for annual rent (illustrative terms) with private pool and maid's room, steps from the central park.", amenities: ["POOL", "PARKING", "SECURITY", "MAID_ROOM", "SMART_HOME", "PET_FRIENDLY"] },
  { slug: "hills-study-studio-hills", title: "Studio with Study Nook, Dubai Hills", community: "dubai-hills-estate", type: "STUDIO", beds: 0, baths: 1, area: 520, price: 720_000, listingType: "SALE", furnishing: "UNFURNISHED", agent: "advisory-desk", images: ["/images/properties/apartment-jvc-interior.jpg"], highlights: ["Study nook layout", "Park-facing tower", "Efficient service charges"], description: "Efficient studio layout with a defined study nook in a park-facing tower. Suited to first-time investors; building includes pool and gym.", amenities: ["POOL", "GYM", "PARKING", "SECURITY", "STUDY"] },
];

/* Market data — ILLUSTRATIVE (labeled; replaced by DLD import in production) */
function illustrativeTransactions() {
  const rows: { areaName: string; propertyType: string; amount: number; date: Date; sizeSqft?: number; project?: string }[] = [];
  const areas = ["Dubai Marina", "Downtown Dubai", "Business Bay", "JVC", "Palm Jumeirah", "Arabian Ranches", "Dubai Hills Estate"];
  const types = ["Apartment", "Villa", "Townhouse"];
  // deterministic pseudo-random
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 260; i++) {
    const area = areas[Math.floor(rand() * areas.length)];
    const type = area.includes("Ranches") || area.includes("Hills") ? (rand() > 0.4 ? "Villa" : "Townhouse") : types[Math.floor(rand() * 2)];
    const base = type === "Villa" ? 4_500_000 : type === "Townhouse" ? 2_400_000 : 1_600_000;
    const size = type === "Villa" ? 3200 + Math.floor(rand() * 2400) : type === "Townhouse" ? 1800 + Math.floor(rand() * 700) : 700 + Math.floor(rand() * 1100);
    const amount = Math.round((base * (0.6 + rand() * 1.1)) / 10000) * 10000;
    const date = new Date(Date.now() - Math.floor(rand() * 540) * 86400_000);
    rows.push({ areaName: area, propertyType: type, amount, date, sizeSqft: size, project: undefined });
  }
  return rows;
}

function illustrativeRents() {
  const rows: { areaName: string; propertyType: string; bedrooms: number; rent: number; date: Date }[] = [];
  const areas = ["Dubai Marina", "Downtown Dubai", "Business Bay", "JVC", "Arabian Ranches", "Dubai Hills Estate"];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 200; i++) {
    const area = areas[Math.floor(rand() * areas.length)];
    const bedrooms = Math.floor(rand() * 4);
    const base = area === "JVC" ? 50_000 : area === "Dubai Marina" || area === "Downtown Dubai" ? 110_000 : area === "Arabian Ranches" || area === "Dubai Hills Estate" ? 180_000 : 95_000;
    const rent = Math.round((base * (0.55 + rand() * 0.9) * (1 + bedrooms * 0.45)) / 1000) * 1000;
    const date = new Date(Date.now() - Math.floor(rand() * 540) * 86400_000);
    rows.push({ areaName: area, propertyType: bedrooms >= 2 ? "Apartment" : "Apartment", bedrooms, rent, date });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Main seed                                                           */
/* ------------------------------------------------------------------ */

async function main() {
  if (process.env.APP_ENV === "production") throw new Error("Demo seed is disabled in production. Use db:initialize for authorization only.");
  /* Provision authorization before the optional demo-data short circuit. */
  for (const [roleKey, permissionKeys] of Object.entries(ROLE_PERMISSION_MANIFEST)) {
    const role = await db.role.upsert({
      where: { key: roleKey },
      create: { key: roleKey, name: roleKey.replace(/_/g, " ") },
      update: {},
    });
    for (const permissionKey of permissionKeys) {
      const permission = await db.permission.upsert({
        where: { key: permissionKey },
        create: { key: permissionKey },
        update: {},
      });
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }
  }

  const marker = await db.importSource.findFirst({ where: { name: "DEMO_SEED" } });
  if (marker && !process.argv.includes("--refresh")) {
    // The database is canonical and the search index is a rebuildable projection.
    // A seed may run after the web process has already built an empty index, so
    // even the idempotent fast path must restore the projection from current rows.
    await rebuildIndex();
    console.log("Seed marker found — skipping (use `bun run db:reset` to reseed, or `bun run db/seed.ts --refresh` to upsert new content additively).");
    return;
  }
  if (marker) {
    console.log("Seed marker found — running additive content refresh (idempotent upserts only)…");
  }

  console.log("Seeding Investment Experts development fixtures…");

  /* Organization + owner */
  const org = await db.organization.upsert({
    where: { slug: "investment-experts" },
    create: { name: "Investment Experts", slug: "investment-experts", legalName: "Investment Experts Real Estate (Development)", isDefault: true },
    update: {},
  });
  const ownerEmail = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const ownerPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (Boolean(ownerEmail) !== Boolean(ownerPassword)) {
    throw new Error("ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD must be supplied together");
  }
  if (ownerEmail && ownerPassword) {
    const ownerRole = (await db.role.findUnique({ where: { key: "OWNER" } }))!;
    await db.user.upsert({
      where: { email: ownerEmail },
      create: {
        email: ownerEmail,
        name: process.env.ADMIN_BOOTSTRAP_NAME ?? "Platform Owner",
        passwordHash: hashPassword(ownerPassword),
        organizationId: org.id,
        emailVerified: now(),
        profile: { create: {} },
        roles: { create: { roleId: ownerRole.id } },
      },
      update: {},
    });
    console.log(`  owner: ${ownerEmail} (explicit development bootstrap)`);
  } else {
    console.log("  owner: skipped (set explicit ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD to create one)");
  }

  /* Amenities */
  for (const a of AMENITIES) {
    await db.amenity.upsert({ where: { key: a.key }, create: a, update: { name: a.name, category: a.category } });
  }

  /* Communities */
  for (const c of COMMUNITIES) {
    const cover = await ensureMedia(c.image, c.name, `${c.name} — community aerial view (demo fixture)`);
    await db.community.upsert({
      where: { slug: c.slug },
      create: {
        name: c.name, slug: c.slug, summary: c.summary, areaType: c.areaType,
        lat: c.lat, lng: c.lng, radiusMeters: c.radius ?? 2000,
        avgPricePerSqftMinor: c.avgPricePerSqft ? AED(c.avgPricePerSqft) : null,
        lifestyleTagsJson: JSON.stringify(c.tags),
        transportJson: JSON.stringify(c.transport),
        schoolsJson: JSON.stringify(c.schools),
        imageMediaId: cover.id,
        publicationStatus: "PUBLISHED", sourceType: "DEMO_SEED", isDemoData: true,
      },
      update: { imageMediaId: cover.id },
    });
  }

  /* Developers */
  for (const d of DEVELOPERS) {
    await db.developer.upsert({
      where: { slug: d.slug },
      create: { ...d, lastVerifiedAt: now(), sourceType: "DEMO_SEED", isDemoData: true },
      update: {},
    });
  }

  /* Projects + payment plans */
  const planTemplate = await db.paymentPlan.findFirst({ where: { name: "Standard 60/40" } });
  if (!planTemplate) {
    for (const p of PROJECTS) {
      const project = await db.project.upsert({
        where: { slug: p.slug },
        create: {
          name: p.name, slug: p.slug, tagline: p.tagline,
          summary: `${p.name} is a development fixture in ${p.community.replace(/-/g, " ")} used for demonstration. Payment plan and dates are illustrative.`,
          description: `Development fixture project. In production this record is sourced from the developer feed with verified dates, pricing and construction sources (see provenance fields).`,
          status: p.status, projectType: p.type as string,
          developerId: (await db.developer.findUnique({ where: { slug: p.developer } }))!.id,
          communityId: (await db.community.findUnique({ where: { slug: p.community } }))!.id,
          handoverDate: p.handover, completionPercent: p.completion,
          startingPriceMinor: p.startingPrice, currency: "AED",
          lat: p.lat, lng: p.lng,
          totalUnits: p.units,
          highlightsJson: JSON.stringify(["Demo fixture project", "Illustrative payment plan", "Replace with verified developer feed"]),
          publicationStatus: "PUBLISHED", sourceType: "DEMO_SEED", isDemoData: true, sourceVerifiedAt: now(),
        },
        update: {},
      });
      const plan = await db.paymentPlan.create({
        data: {
          projectId: project.id, name: "Standard 60/40", currency: "AED",
          totalPercent: 100, postHandover: true, verificationStatus: "PUBLISHED",
          isDefault: true, validFrom: now(),
          notes: "Illustrative plan (development fixture). Production plans carry verification status and source documents.",
        },
      });
      for (const [i, inst] of PAYMENT_PLAN_STANDARD.entries()) {
        await db.paymentPlanInstallment.create({
          data: { paymentPlanId: plan.id, sequence: i + 1, label: inst.label, percent: inst.percent, dueOffsetMonths: inst.dueOffsetMonths },
        });
      }
      // project cover media
      await db.projectMedia.create({ data: { projectId: project.id, mediaId: (await ensureMedia(p.image, p.name, "Development render (demo fixture)")).id, section: "GALLERY", sortOrder: 0 } });
    }
  }

  /* Agents — verified team (V3-02): Advisory Desk + 25 real members.
   * No invented attributes: languages/specialties/communities/years/bio
   * stay empty (null) until CRM-verified data arrives. */
  for (const a of AGENTS) {
    await db.agent.upsert({
      where: { slug: a.slug },
      create: {
        name: a.name, slug: a.slug, jobTitle: a.jobTitle, bio: "",
        phoneE164: a.phone, whatsappE164: a.whatsapp, phoneDisplay: a.phoneDisplay,
        email: null,
        languagesJson: null, specialtiesJson: null, communitiesJson: null,
        yearsExperience: 0, active: true, leadCapacityState: "AVAILABLE",
        sortWeight: a.weight,
        isDemoData: false, sourceType: "VERIFIED_TEAM",
        department: a.department, publicAdvisor: a.publicAdvisor, photoUrl: a.photoUrl,
      },
      update: {},
    });
  }

  /* Media registry + properties + listings */
  for (const p of PROPERTIES) {
    const community = (await db.community.findUnique({ where: { slug: p.community } }))!;
    const project = p.project ? await db.project.findUnique({ where: { slug: p.project } }) : null;
    const developer = p.developer ? await db.developer.findUnique({ where: { slug: p.developer } }) : null;
    const agent = (await db.agent.findUnique({ where: { slug: p.agent } }))!;

    const property = await db.property.upsert({
      where: { slug: p.slug },
      create: {
        title: p.title, slug: p.slug,
        projectId: project?.id ?? null, communityId: community.id, developerId: developer?.id ?? project?.developerId ?? null,
        propertyType: p.type, bedrooms: p.beds, bathrooms: p.baths,
        builtUpAreaSqft: p.area,
        furnishing: p.furnishing ?? null, view: p.view ?? null,
        lat: community.lat + (Math.random() - 0.5) * 0.008,
        lng: community.lng + (Math.random() - 0.5) * 0.008,
        shortDescription: p.highlights[0],
        description: p.description,
        highlightsJson: JSON.stringify(p.highlights),
        handoverQuarter: p.handover ?? null,
        publicationStatus: "PUBLISHED",
        sourceType: "DEMO_SEED", isDemoData: true, sourceUpdatedAt: now(),
      },
      update: {},
    });

    const listing = await db.listing.findFirst({ where: { propertyId: property.id } });
    if (!listing) {
      const created = await db.listing.create({
        data: {
          propertyId: property.id,
          listingType: p.listingType,
          priceMinor: AED(p.price),
          currency: "AED",
          rentFrequency: p.listingType === "RENT" ? "YEARLY" : null,
          priceQualifier: p.offPlan ? "From" : null,
          availabilityStatus: p.availability ?? "AVAILABLE",
          offPlan: !!p.offPlan,
          isFeatured: !!p.featured,
          isExclusive: !!p.exclusive,
          agentId: agent.id,
          publishedAt: daysFromNow(-Math.floor(Math.random() * 90)),
          serviceChargePerSqft: community.slug === "dubai-marina" ? 18 : community.slug === "jumeirah-village-circle" ? 12 : 15,
        },
      });
      await db.priceHistory.create({
        data: { propertyId: property.id, listingId: created.id, priceMinor: AED(p.price), sourceType: "DEMO_SEED" },
      });
    }

    /* Trailing price points for trend visualization (sale listings; idempotent — backfills existing too) */
    if (p.listingType === "SALE") {
      const drift = 0.035 + (p.slug.length % 6) * 0.006; // 3.5–6.5% per step, stable per slug
      for (const step of [3, 2, 1]) {
        const existing = await db.priceHistory.findFirst({
          where: { propertyId: property.id, recordedAt: daysFromNow(-step * 120) },
        });
        if (!existing) {
          await db.priceHistory.create({
            data: {
              propertyId: property.id, listingId: listing?.id ?? null,
              priceMinor: AED(Math.round(p.price / (1 + drift) ** step)),
              recordedAt: daysFromNow(-step * 120),
              sourceType: "DEMO_SEED",
            },
          });
        }
      }
    }

    // media
    for (const [i, img] of p.images.entries()) {
      const media = await ensureMedia(img, p.title, `${p.title} — ${community.name} (demo fixture image)`);
      const existing = await db.propertyMedia.findFirst({ where: { propertyId: property.id, mediaId: media.id } });
      if (!existing) {
        await db.propertyMedia.create({ data: { propertyId: property.id, mediaId: media.id, sortOrder: i, isCover: i === 0 } });
      }
    }

    // amenities
    for (const akey of p.amenities) {
      const amenity = await db.amenity.findUnique({ where: { key: akey } });
      if (amenity) {
        await db.propertyAmenity.upsert({
          where: { propertyId_amenityId: { propertyId: property.id, amenityId: amenity.id } },
          create: { propertyId: property.id, amenityId: amenity.id },
          update: {},
        });
      }
    }

    // floor plans (sample for larger units)
    if (p.area > 900 && p.images[0]) {
      const fpMedia = await ensureMedia("/images/brand/floorplan-sample.jpg", `${p.title} floor plan`, `${p.title} — indicative floor plan (demo fixture)`);
      const existingFp = await db.propertyFloorPlan.findFirst({ where: { propertyId: property.id } });
      if (!existingFp) {
        await db.propertyFloorPlan.create({
          data: {
            propertyId: property.id, mediaId: fpMedia.id,
            label: `${p.beds === 0 ? "Studio" : `${p.beds}-Bed`} layout`,
            bedrooms: p.beds, areaSqft: p.area,
            priceMinor: AED(p.price),
          },
        });
      }
    }
  }

  /* Market data (ILLUSTRATIVE) */
  const importSource = await db.importSource.upsert({
    where: { name: "DEMO_SEED" },
    create: { name: "DEMO_SEED", sourceType: "INTERNAL", notes: "Development fixture generator (ADR-010)", isActive: false },
    update: {},
  });
  const run = await db.importRun.create({
    data: { importSourceId: importSource.id, status: "SUCCEEDED", startedAt: now(), finishedAt: now(), triggeredBy: marker ? "seed-refresh" : "seed" },
  });

  for (const t of illustrativeTransactions()) {
    const key = `demo-tx-${t.areaName}-${t.date.toISOString().slice(0, 10)}-${t.amount}`;
    await db.marketTransaction.upsert({
      where: { sourceRecordKey: key },
      create: {
        source: "DEMO", sourceRecordKey: key, transactionDate: t.date,
        areaName: t.areaName, propertyType: t.propertyType,
        amountMinor: AED(t.amount), sizeSqft: t.sizeSqft,
        pricePerSqftMinor: t.sizeSqft ? AED(Math.round(t.amount / t.sizeSqft)) : null,
        importRunId: run.id, isIllustrative: true,
      },
      update: {},
    });
  }
  for (const r of illustrativeRents()) {
    const key = `demo-rent-${r.areaName}-${r.date.toISOString().slice(0, 10)}-${r.rent}-${r.bedrooms}`;
    await db.marketRent.upsert({
      where: { sourceRecordKey: key },
      create: {
        source: "DEMO", sourceRecordKey: key, contractDate: r.date,
        areaName: r.areaName, propertyType: r.propertyType, bedrooms: r.bedrooms,
        annualRentMinor: AED(r.rent), importRunId: run.id, isIllustrative: true,
      },
      update: {},
    });
  }

  /* Market metrics (ILLUSTRATIVE, per community) */
  for (const c of COMMUNITIES) {
    const community = (await db.community.findUnique({ where: { slug: c.slug } }))!;
    const base = c.avgPricePerSqft ?? 1200;
    const metrics: [string, number, string][] = [
      ["MEDIAN_TRANS_PRICE", base * (c.areaType === "ISLAND" ? 9000 : c.areaType === "RESIDENTIAL" ? 4200 : 1900), "AED"],
      ["AVG_PRICE_PER_SQFT", base, "AED_PER_SQFT"],
      ["AVG_RENT_1BR", base * 55, "AED"],
      ["TRANSACTION_COUNT", Math.round(base / 40), "COUNT"],
      ["YIELD_PCT", c.areaType === "SUBURBAN" ? 7.4 : c.areaType === "ISLAND" ? 4.8 : 5.9, "PERCENT"],
    ];
    for (const [key, value, unit] of metrics) {
      await db.marketMetric.upsert({
        where: { communityId_metricKey_periodStart: { communityId: community.id, metricKey: key, periodStart: daysFromNow(-90) } },
        create: {
          communityId: community.id, metricKey: key,
          periodStart: daysFromNow(-90), periodEnd: now(),
          valueNumeric: value, unit,
          sourceName: "Illustrative model (dev)", methodology: "Generated fixture values — not market data. Production metrics are computed from the DLD import with documented transformation.",
          isIllustrative: true,
        },
        update: {},
      });
    }
    /* Quarterly trend history (5 trailing quarters) for trend visualizations — deterministic fixture series */
    const growthPerQuarter = 0.014 + (community.slug.length % 5) * 0.002; // 1.4–2.2% per quarter, stable per slug
    for (const [key, latestValue, unit] of metrics) {
      if (key === "TRANSACTION_COUNT") continue;
      for (let q = 1; q <= 5; q++) {
        const start = daysFromNow(-90 - q * 91);
        const end = daysFromNow(-90 - (q - 1) * 91);
        const histValue = key === "YIELD_PCT"
          ? Number((latestValue + (q - 1) * 0.06).toFixed(2)) // mild yield softening backwards
          : Math.round(latestValue / (1 + growthPerQuarter) ** q);
        await db.marketMetric.upsert({
          where: { communityId_metricKey_periodStart: { communityId: community.id, metricKey: key, periodStart: start } },
          create: {
            communityId: community.id, metricKey: key,
            periodStart: start, periodEnd: end,
            valueNumeric: histValue, unit,
            sourceName: "Illustrative model (dev)", methodology: "Generated quarterly fixture series for trend visualization — not market data.",
            isIllustrative: true,
          },
          update: {},
        });
      }
    }
  }

  /* Market reports (fixtures, gated) */
  const reportMedia = await ensureMedia("/images/communities/downtown-dubai.jpg", "Market report cover", "Market intelligence report cover (demo fixture)");
  const marinaMedia = await ensureMedia("/images/communities/dubai-marina.jpg", "Waterfront report cover", "Waterfront communities report cover (demo fixture)");
  const jvcMedia = await ensureMedia("/images/communities/jumeirah-village-circle.jpg", "Suburban yield report cover", "Suburban yield report cover (demo fixture)");
  const REPORTS: { slug: string; title: string; summary: string; periodLabel: string; body: string; coverMediaId: string; publishedDaysAgo: number; gated: boolean }[] = [
    {
      slug: "dubai-investment-briefing-h2-2026",
      title: "Dubai Investment Briefing — H2 2026",
      summary: "Community-level price, rent and yield overview with methodology and provenance. Development fixture: figures are illustrative pending the DLD data import.",
      periodLabel: "H2 2026",
      body: "# Dubai Investment Briefing — H2 2026\n\n**Provenance note:** this is a development-fixture report. All figures are illustrative and clearly labeled as such in the platform; production reports are generated from the Dubai Land Department open-data import with documented methodology and retrieval timestamps.\n\n## Key themes\n\n- Waterfront communities continue to trade at a premium per sqft relative to inland equivalents.\n- Established suburban communities show the strongest modeled yields at lower entry prices.\n- Off-plan payment structures remain a central decision variable for investors.\n\n## Methodology\n\nMedian transaction value by community; median annual rent; gross yield computed as median rent over median price. Sample sizes and exclusions are stated in production reports.",
      coverMediaId: reportMedia.id, publishedDaysAgo: 12, gated: true,
    },
    {
      slug: "waterfront-outlook-q3-2026",
      title: "Waterfront Communities Outlook — Q3 2026",
      summary: "Price-per-sqft spreads, premium drift and yield compression across Dubai's waterfront communities, with supply-pipeline context. Development fixture: illustrative figures pending the DLD import.",
      periodLabel: "Q3 2026",
      body: "# Waterfront Communities Outlook — Q3 2026\n\n**Provenance note:** development-fixture report; illustrative figures pending the production DLD import. Every figure in production carries source and retrieval dates.\n\n## Scope\n\nDubai Marina, Palm Jumeirah, Business Bay canal-front stock and the emerging waterfront master plans.\n\n## Modeled observations\n\n- Waterfront per-sqft medians carry a persistent premium over inland equivalents in the same unit class; the premium widens for larger balconies and unobstructed water aspects.\n- Yield compression is most visible at the ultra-prime end, where price growth has outpaced rent growth in the fixture model.\n- Short-stay licensing density concentrates in waterfront communities — occupancy seasonality matters more here than elsewhere.\n\n## Supply context\n\nWaterfront delivery schedules are public; the fixture models a meaningful pipeline concentrated in the later years of the plan horizon. Production reports quantify announced, under-construction and completed supply by community.\n\n## What we would watch\n\nPremium drift vs inland stock; short-stay permit issuance; mortgage-rate spreads against modeled gross yields at the prime end.",
      coverMediaId: marinaMedia.id, publishedDaysAgo: 5, gated: true,
    },
    {
      slug: "suburban-yield-playbook-2026",
      title: "Suburban Yield Playbook — 2026",
      summary: "Where modeled gross yields remain strongest: community selection, unit-type mix, service-charge drag and the rent-growth contribution. Development fixture: illustrative figures pending the DLD import.",
      periodLabel: "2026",
      body: "# Suburban Yield Playbook — 2026\n\n**Provenance note:** development-fixture report; illustrative figures pending the production DLD import.\n\n## The thesis\n\nEstablished suburban communities combine lower entry prices with persistent rental demand from families and value-driven tenants — the combination that supports the strongest modeled gross yields in the fixture data.\n\n## The four levers\n\n1. **Community selection:** tenant demand depth (schools, retail, transport feeders) matters more than headline appreciation narratives.\n2. **Unit-type mix:** mid-size apartments and modest townhouses persistently out-rent larger configurations in these communities, per the fixture model.\n3. **Service-charge drag:** per-sqft charges vary widely between buildings of similar age; the drag on net yield is material and checkable before purchase.\n4. **Rent-growth contribution:** rent indexation on renewals compounds — production reports use the RERA rental index series to quantify the contribution.\n\n## The caution list\n\n- New supply in adjacent plots can compress rents at the margin — check the delivery schedule around any target community.\n- Ultra-high yields on stale data are usually a composition effect or a liquidity signal, not free return.\n\n## Methodology\n\nGross yield = median annual rent over median transaction price by community and unit type; service-charge drag modeled from published per-sqft rates. Production reports compute these from DLD transactions and the rental index with full provenance.",
      coverMediaId: jvcMedia.id, publishedDaysAgo: 2, gated: true,
    },
  ];
  for (const r of REPORTS) {
    await db.marketReport.upsert({
      where: { slug: r.slug },
      create: {
        slug: r.slug,
        title: r.title,
        summary: r.summary,
        periodLabel: r.periodLabel,
        methodology: "Fixture report. In production: DLD transactions/rents aggregated by community and quarter; medians on arm's-length sales; yields = median rent ÷ median price; all figures carry source and retrieval dates.",
        dataSourceName: "Illustrative (development fixture)",
        retrievedAt: now(),
        body: r.body,
        coverMediaId: r.coverMediaId,
        status: "PUBLISHED", gated: r.gated, publishedAt: daysFromNow(-r.publishedDaysAgo),
      },
      update: {},
    });
  }

  /* Content: guides, articles, FAQs */
  const guides = await buildGuides();
  for (const g of guides) {
    await db.contentEntry.upsert({
      where: { slug: g.slug },
      create: {
        contentType: "GUIDE", slug: g.slug, title: g.title, excerpt: g.excerpt,
        body: "", category: g.category, status: "DRAFT",
        reviewWorkflowState: "NONE",
        sourceName: null, sourceUrl: null, sourceVerifiedAt: null,
        freshnessReviewDueAt: null,
        readingMinutes: g.readingMinutes, publishedAt: null,
        coverMediaId: (await ensureMedia(g.image, g.title, `${g.title} — cover image (demo fixture)`)).id,
      },
      update: {},
    });
  }

  const articles = buildArticles();
  for (const a of articles) {
    await db.contentEntry.upsert({
      where: { slug: a.slug },
      create: {
        contentType: "ARTICLE", slug: a.slug, title: a.title, excerpt: a.excerpt,
        body: "", category: a.category, status: "DRAFT",
        reviewWorkflowState: "NONE",
        tagsJson: JSON.stringify(a.tags),
        sourceName: null, sourceUrl: null, sourceVerifiedAt: null,
        freshnessReviewDueAt: null,
        readingMinutes: a.readingMinutes, publishedAt: null,
        coverMediaId: (await ensureMedia(a.image, a.title, `${a.title} — cover image (demo fixture)`)).id,
      },
      update: {},
    });
  }

  for (const [i, q] of buildFaqs().entries()) {
    await db.faq.upsert({
      where: { id: `faq-${i + 1}` },
      create: { groupKey: q.group, question: q.question, answer: q.answer, sortOrder: i, isActive: false },
      update: {},
    });
  }

  /* RAG knowledge documents + sources */
  await seedRag();

  /* Feature flags + one experiment */
  for (const flag of [
    { key: "ai_advisor", description: "AI Property Advisor availability", isEnabled: true, rolloutPercent: 100 },
    { key: "nl_search", description: "Natural-language search bar", isEnabled: true, rolloutPercent: 100 },
    { key: "arabic_locale", description: "Arabic locale foundation (RTL)", isEnabled: true, rolloutPercent: 100 },
    { key: "saved_search_alerts", description: "Saved-search matching alerts", isEnabled: true, rolloutPercent: 100 },
    { key: "personalization", description: "Consent-aware recommendations", isEnabled: true, rolloutPercent: 100 },
  ]) {
    // Seed missing defaults once, but never overwrite operator-controlled kill switches.
    await db.featureFlag.upsert({ where: { key: flag.key }, create: flag, update: {} });
  }
  await db.experiment.upsert({
    where: { key: "home_hero_cta" },
    create: {
      key: "home_hero_cta", name: "Homepage hero CTA copy",
      hypothesis: "Advisor-led CTA increases qualified lead rate vs generic search CTA",
      status: "RUNNING",
      variantsJson: JSON.stringify([
        { key: "control", weight: 50, description: "Search properties" },
        { key: "advisor", weight: 50, description: "Ask the AI Advisor" },
      ]),
      primaryMetric: "lead_generated", startedAt: now(),
      guardMetricsJson: JSON.stringify(["page_view", "form_start"]),
    },
    update: {},
  });

  /* Redirects (migration fixtures) */
  for (const r of [
    { from: "/old-properties", to: "/properties", note: "Legacy search URL" },
    { from: "/offplan", to: "/off-plan", note: "Spelling normalization" },
    { from: "/agents-directory", to: "/agents", note: "Legacy directory" },
  ]) {
    await db.redirect.upsert({ where: { fromPath: r.from }, create: { fromPath: r.from, toPath: r.to, note: r.note }, update: {} });
  }

  console.log("Seed complete:");
  const index = await rebuildIndex();
  console.log(`Search index rebuilt with ${index.count} public listings.`);
  const counts = {
    communities: await db.community.count(),
    developers: await db.developer.count(),
    projects: await db.project.count(),
    agents: await db.agent.count(),
    properties: await db.property.count(),
    listings: await db.listing.count(),
    transactions: await db.marketTransaction.count(),
    rents: await db.marketRent.count(),
    guides: await db.contentEntry.count(),
    ragDocs: await db.ragDocument.count(),
  };
  console.log(JSON.stringify(counts, null, 2));
}

/* Media registry helper — registers static fixture images in the media table */
const mediaRegistry = new Map<string, string>();
async function ensureMedia(url: string, title: string, alt: string): Promise<{ id: string }> {
  const existing = mediaRegistry.get(url);
  if (existing) return { id: existing };
  const filename = url.split("/").pop()!;
  const found = await db.mediaAsset.findFirst({ where: { url } });
  if (found) {
    mediaRegistry.set(url, found.id);
    return found;
  }
  const fs = await import("fs/promises");
  let size = 0;
  try {
    const stat = await fs.stat(`${process.cwd()}/public${url}`);
    size = stat.size;
  } catch {
    size = 0; // image generation may still be running
  }
  const created = await db.mediaAsset.create({
    data: {
      kind: url.includes("floorplan") ? "FLOOR_PLAN" : "IMAGE",
      storageKey: `static${url}`,
      url,
      mimeType: url.endsWith(".png") ? "image/png" : "image/jpeg",
      sizeBytes: size,
      altText: alt,
      caption: title,
      exifStripped: true,
    },
  });
  mediaRegistry.set(url, created.id);
  return created;
}

async function seedRag() {
  const sources: { key: string; title: string; tier: string; url?: string }[] = [
    { key: "ie-guides", title: "Investment Experts Editorial Guides", tier: "INTERNAL" },
  ];
  for (const s of sources) {
    await db.ragSource.upsert({
      where: { id: `src-${s.key}` },
      create: { id: `src-${s.key}`, sourceType: "INTERNAL_DOC", canonicalUrl: null, title: s.title, trustTier: s.tier, isApproved: false, isActive: true },
      update: {},
    });
  }

  const { ingestDocument } = await import("../src/server/rag/pipeline");

  const docs: { sourceId: string; slug: string; title: string; content: string }[] = [
    {
      sourceId: "src-ie-guides",
      slug: "rental-yield-methodology",
      title: "IERE rental-yield calculation methodology (internal)",
      content: `Methodology (Investment Experts editorial standard).

Gross rental yield = annual contract rent ÷ purchase price × 100.

Net rental yield = (annual rent − annual costs) ÷ purchase price × 100, where annual costs include service charges (from the listing or community data with source and date), maintenance allowance, management fees where applicable, and vacancy allowance.

All yield figures on the platform separate:
- FACTS: listed price, actual rent where known.
- ASSUMPTIONS: vacancy rate, maintenance allowance, management fees (user-adjustable).
- PROJECTIONS: any capital appreciation scenario is shown separately and never merged into yield.

Yields are illustrative decision support, not guaranteed outcomes. Community-level yields use median transaction prices and median rents from the market-intelligence dataset with its provenance and freshness labels.`,
    },
  ];

  for (const d of docs) {
    await ingestDocument({ sourceId: d.sourceId, title: d.title, slug: d.slug, content: d.content });
  }
}

async function buildGuides() {
  const fs = await import("fs/promises");
  const mk = (slug: string, title: string, excerpt: string, category: string, readingMinutes: number, image: string, body: string, sourceName: string, sourceUrl: string) => ({ slug, title, excerpt, category, readingMinutes, image, body, sourceName, sourceUrl });
  return [
    mk("buying-in-dubai", "Buying Property in Dubai — Step-by-Step (2026)", "The complete purchase journey: costs, escrow, title transfer and timelines, with verified fee references.", "Buying", 9, "/images/brand/hero-skyline.jpg",
`# Buying property in Dubai

This guide walks through the standard purchase journey in Dubai with verified references for fees and procedures.

## 1. Budget and financing
Beyond the property price, plan for the DLD transfer fee (4% of price, customarily split), agency commission (commonly 2%), and mortgage registration (0.25% of the loan) if financing. Use the platform's mortgage calculator to test down-payment scenarios.

## 2. Choose the property and verify the listing
Confirm the listing's provenance fields — source, verification date and any demo/illustrative labels. For off-plan, confirm RERA project registration and the escrow account (see the off-plan guide).

## 3. Agreement and deposit
A Memorandum of Understanding (Form F) records the terms. The buyer typically pays a 10% deposit held against the transfer. For off-plan, the sale agreement and payment schedule govern.

## 4. NOC and transfer
For secondary sales, the developer issues a No-Objection Certificate after settling service charges. The transfer completes at the DLD trustee office; the title deed is issued in the buyer's name.

## 5. After completion
Register utilities, set up service-charge payments, and — for investors — align the handover with a rental strategy.

_Sources: Dubai Land Department fee schedules and RERA procedures; verified 2026-09. This guide is general information, not legal advice._`, "Dubai Land Department / RERA procedures", "https://dubailand.gov.ae/"),
    mk("selling-in-dubai", "Selling Your Dubai Property — Preparation, Pricing and Process", "Valuation inputs, listing preparation, transfer mechanics and seller costs, with a valuation request path.", "Selling", 8, "/images/communities/dubai-marina.jpg",
`# Selling property in Dubai

## Preparing to sell
Gather the title deed, mortgage status, service-charge clearance and (for tenanted units) the rental contract. Cosmetic staging and complete documentation reliably shorten time-to-offer.

## Pricing
Anchor the asking price on comparable transactions in the same community, adjusted for floor, view, condition and parking. The platform's market intelligence shows community-level medians with source and freshness labels; a professional valuation adds unit-level precision.

## Marketing
Curated photography, floor plan and a structured fact sheet — the same provenance standard this platform applies to every listing — materially improve enquiry quality.

## Transfer mechanics
Once terms are agreed, sign Form F, settle any mortgage and service charges, obtain the developer NOC and complete transfer at the DLD trustee office. Seller costs customarily include half of the 4% DLD transfer fee plus agency commission.

_Request a valuation through the Sell section to begin._`, "Investment Experts advisory practice", "/guides"),
    mk("off-plan-explained", "Off-Plan in Dubai: Escrow, Payment Plans and Risk", "How off-plan purchases work in Dubai: RERA registration, escrow protection, payment-plan structures and a practical due-diligence checklist.", "Off-plan", 10, "/images/projects/tower-render-1.jpg",
`# Off-plan explained

## Why off-plan
Lower entry pricing, staged payment plans and first-pick unit selection. Against that: completion risk, waiting period before rental income and market-cycle exposure.

## Buyer protections
Dubai requires RERA project registration before marketing and project-specific escrow accounts for buyer funds, with withdrawals tied to certified construction progress (see the verified escrow summary in our knowledge base).

## Payment plans
Plans typically combine a booking deposit, construction-linked installments and handover/post-handover balances. The platform shows each plan's verification status — treat unverified schedules as indicative until developer confirmation.

## Due diligence checklist
- RERA registration and escrow account confirmed
- Developer track record on previous handovers
- Payment schedule stress-tested against your cash flow
- Unit-level factors: floor, aspect, service charges, parking
- Exit strategy: assignment terms before handover

_Off-plan purchase decisions should include professional advice on contract terms._`, "RERA escrow regulations", "https://dubailand.gov.ae/"),
    mk("golden-visa-guide", "UAE Golden Visa through Property Investment", "Residency-by-investment basics for property buyers: thresholds, eligibility, documents and renewal, with verified source links.", "International", 7, "/images/brand/beach-lifestyle.jpg",
`# UAE Golden Visa through property investment

The UAE offers a 10-year renewable Golden Visa; property investment is one of the qualifying routes.

## Threshold and eligibility (verified summary)
The commonly referenced real-estate threshold is AED 2 million in registered property. Rules permit combining mortgaged and off-plan assets in some cases, subject to current executive regulations; the property must be retained for renewal.

## Process overview
1. Obtain a property valuation and title-deed evidence.
2. Compile the application (passport, title deed, valuation, NOC if mortgaged).
3. Apply through the designated channel; issuance includes the Emirates ID step.

## Practical notes
- Off-plan from registered developers can qualify under current rules — confirm before relying on it.
- Retaining the asset is a renewal condition.
- Rules evolve: this guide carries a review date and should be confirmed with a licensed advisor at decision time.

_Sources: UAE federal channels; verified 2026-09. General information only — not legal advice._`, "UAE federal legislation portal", "https://u.ae/en/"),
    mk("international-buyers-guide", "International Buyers: Remote Purchase, Financing and Ownership", "Foreign ownership rules, remote transaction workflows, financing options and costs for international buyers in Dubai.", "International", 8, "/images/brand/about-office.jpg",
`# International buyers

## Ownership
Dubai permits foreign ownership in designated freehold areas — the communities on this platform are overwhelmingly freehold for international buyers.

## Buying remotely
A remote purchase is routine: digital NOMI/identity verification, transfer via the trustee process with power of attorney where required, and completion without travel in many cases. Your advisor coordinates the developer or seller side.

## Financing
International residents and non-residents can obtain UAE mortgages with differing loan-to-value and income-documentation requirements. Rates vary by bank and product — use the mortgage calculator for scenario planning, then confirm live quotes.

## Costs and taxes
There is no annual property tax in Dubai. Budget the DLD transfer fee, commission and (for some nationalities' home countries) home-country reporting obligations — take advice at home on reporting.

## After purchase
Furnishing and rental management can both be delegated; for investors, the short-stay and long-stay strategy drives net yield materially.`, "Investment Experts advisory practice", "/guides"),
    mk("rental-income-landlord-guide", "Rental Income for Landlords — Yields, Contracts and Compliance", "How rental income works in Dubai: Ejari registration, the RERA rental index, short-stay vs annual strategies, and the costs landlords actually carry.", "Investing", 9, "/images/properties/apartment-marina-living.jpg",
`# Rental income for landlords

Dubai's rental market pairs comparatively strong gross yields with a light compliance load — provided the paperwork is right.

## The legal skeleton
Annual tenancies are registered through Ejari. Rent increases for renewals are guided by the RERA rental index calculator — a step that both parties can check independently. Short-stay (holiday-home) letting requires a DET permit per unit and follows its own compliance track.

## Short-stay vs annual
Short-stay gross income can exceed annual rent in high-tourism communities, but net outcomes depend on occupancy, management fees, utility top-ups and permit costs. Annual tenancies trade a lower headline rate for predictable cash flow, single-turnover risk and lower operating overhead. Model both before committing — the yield calculator on this platform separates facts from assumptions for exactly this reason.

## Costs landlords actually carry
- Service charges (community and building) — usually charged per sqft annually
- Maintenance obligations: by law, major (structural, MEP) sits with the landlord unless the contract says otherwise
- Management fees where outsourced (commonly a share of collected rent)
- Mortgage payments, where financed

## Compliance quick list
- Ejari registration for annual tenancies
- DET holiday-home permit for short-stay units
- Security deposits capped by rule at 5% of annual rent (annual contracts)
- Notice periods for renewal changes are fixed — check current RERA guidance before serving notice

_Sources: RERA tenancy and rental-index guidance; DET holiday-home rules; verified 2026-09. General information, not legal advice._`, "RERA tenancy regulations / DET holiday-home rules", "https://dubailand.gov.ae/"),
    mk("mortgage-financing-guide", "Mortgages in Dubai — LTV Rules, Rates and the Application Process", "Loan-to-value rules for residents and non-residents, the rate-setting process, fee stack and a realistic application timeline.", "Financing", 8, "/images/brand/about-office.jpg",
`# Mortgages in Dubai

UAE mortgages are available to residents and non-residents, with different loan-to-value (LTV) ceilings, income-documentation standards and rate options.

## LTV in outline
Central-bank rules set maximum LTV for a first property (broadly: residents up to 80% under AED 5M with variations above; non-residents typically lower, commonly 50–65% by lender policy). Lenders layer their own caps by property type, age and income profile — treat published caps as ceilings, not entitlements.

## Rates and structures
Rates are typically priced as a spread over EIBOR, fixed for an initial period (commonly 1–5 years) then reverting. Fee stacks matter as much as headline rates: arrangement fees (~1% of the loan is common), valuation fees, mortgage registration (0.25% of the loan at DLD) and life-insurance requirements.

## The application timeline
1. Pre-qualification and document pack (income evidence; for non-residents, bank references and credit context)
2. Conditional offer and property valuation
3. Final offer, life insurance and account setup
4. Transfer-day funding through the trustee process

From complete documents to offer, 2–4 weeks is a realistic planning window; remote applicants should add verification time.

## Practical notes
- Service charges and existing debts feed the debt-burden ratio — declare them early.
- Off-plan mortgages release funds against construction milestones, matching the developer's schedule.
- Use the platform's mortgage calculator for scenario planning, then collect live quotes from at least two lenders.

_Sources: UAE Central Bank mortgage regulations; lender-published product terms; verified 2026-09. General information, not financial advice._`, "UAE Central Bank mortgage standards", "https://www.centralbank.ae/"),
    mk("service-charges-explained", "Service Charges in Dubai — What You Actually Pay to Own", "How service charges are set, what they cover, how to read a community's charge history, and the red flags before you buy.", "Owning", 7, "/images/communities/jvc.jpg",
`# Service charges in Dubai

Service charges are the recurring cost of ownership that out-of-market buyers most often underestimate.

## What they are
Annual charges per square foot, set through the Mollak system for approved budgets, covering common-area maintenance, security, amenities and community services. They are a legal obligation attached to the unit — unpaid charges become a transfer blocker.

## Reading them like an investor
- Compare per-sqft charges across communities before purchase — the spread between a modest tower and a branded-residence tower can be several multiples.
- Ask for the last three years of actual collections and the current budget's approval status.
- Check what the charge includes: chilled water and district cooling are often billed separately and can be material for high-cooling months.
- For off-plan, ask for the developer's indicative service-charge forecast — it is an estimate, not a cap.

## Red flags
- Budgets repeatedly not approved or charges rising well above community norms without works
- High receivables (owners not paying) — signals future special assessments
- Amenities in the sales gallery absent from the approved budget

## Where the platform helps
Community pages surface service-charge levels where sourced, and the yield calculator lets you include a realistic charge as an expense line rather than discovering it post-completion.

_Sources: Mollak service-charge framework; Dubai service-charge rules; verified 2026-09. General information, not legal advice._`, "Mollak / Dubai service-charge framework", "https://dubailand.gov.ae/"),
    mk("off-plan-vs-secondary", "Off-Plan vs Secondary — Which Fits Your Strategy", "A side-by-side decision framework: capital at risk, payment timing, yield start date, customization and exit liquidity for both routes.", "Investing", 8, "/images/projects/waterfront-render.jpg",
`# Off-plan vs secondary

Both routes can work; they solve different problems. The honest comparison is about capital timing, risk posture and income start dates.

## The trade in one table
- **Entry price:** off-plan usually enters below comparable completed stock; secondary prices the market as it is today.
- **Payment timing:** off-plan spreads payments across construction; secondary demands full funding at transfer.
- **Income start:** off-plan yields begin at handover (or later, with fit-out); secondary can be tenanted within weeks of purchase.
- **What you see:** off-plan buys a render and a specification; secondary can be inspected, measured and walked through.
- **Exit liquidity:** off-plan assignments before handover depend on developer terms and market appetite; secondary exits at market speed.
- **Protections:** off-plan carries escrow-and-progress protections (see the off-plan guide); secondary carries title-transfer certainty.

## Strategy patterns we see in practice
- **Yield-now investors** with capital ready tend to secondary, often tenanted assets with proven rent history.
- **Staged-capital investors** who prefer installment schedules and can wait for income go off-plan with verified developers.
- **Portfolio builders** mix both — off-plan for appreciation exposure, secondary for cash-flow floor.

## The checklist that matters more than the route
Developer track record, community fundamentals (supply pipeline, transport, amenity delivery), unit-level factors (floor, aspect, parking), and a stress-tested cash-flow model under your own assumptions.

_Use the comparison tools and calculators on this platform to test both routes against the same unit assumptions._`, "Investment Experts advisory practice", "/guides"),
    mk("market-cycles-timing", "Reading Dubai's Market Cycles — Indicators That Actually Matter", "A framework for timing decisions: transaction volumes vs prices, supply pipeline data, yield spread signals and the indicators that lag.", "Market", 9, "/images/brand/hero-skyline.jpg",
`# Reading Dubai's market cycles

Timing markets precisely is not a solvable problem. Reading market state — early, mid or late cycle — is tractable and changes what a prudent investor does.

## The indicator stack
1. **Transaction volume leads price.** Volumes typically turn before prices do. Falling volume with flat prices is a caution flag; rising volume after a quiet period often precedes price moves.
2. **Supply pipeline is public.** Announced and under-construction delivery schedules by area are knowable in advance; compare them against absorption (transactions) to judge pressure.
3. **Yield spread vs cost of capital.** Gross yields compressed well below mortgage costs signal late-cycle pricing; healthy spreads leave room for leveraged buyers.
4. **Rent-versus-price divergence.** Rents reprice on renewal cycles — a price surge without rent support usually corrects toward rental reality.

## What lags (and misleads)
- Average price-per-unit mixes composition effects — a surge of villa sales can raise the average with no unit-level appreciation.
- Headline sentiment and launch-day queues measure marketing, not the market.

## How the platform supports this
Market intelligence pages separate transaction, rent and yield data with source and freshness on every figure; community pages carry provenance labels rather than blended averages. The point is to let you apply this framework with evidence rather than anecdotes.

## The discipline
Decide your holding period before your entry timing. For 8–10 year holds, entry-cycle precision matters far less than community and unit selection; for 2–3 year flips, cycle state dominates every other variable.

_Sources: DLD open-data transaction series (production import); RERA supply-pipeline disclosures; verified 2026-09. General information, not investment advice._`, "DLD transaction statistics / RERA supply data", "https://dubailand.gov.ae/"),
  ];
}

function buildFaqs() {
  return [
    { group: "GENERAL", question: "Is the inventory on this platform live?", answer: "This deployment is a development environment: the inventory shown is clearly-labeled demo fixture data. In production, listings come from verified brokerage feeds with source and freshness metadata on every record." },
    { group: "GENERAL", question: "Do you charge buyers a fee?", answer: "Buyers customarily pay the DLD transfer fee and agency commission as described in the buying guide; Investment Experts does not charge buyers a separate platform fee. Terms are stated in the engagement agreement." },
    { group: "BUYING", question: "Can foreigners buy property in Dubai?", answer: "Yes — foreign nationals can own freehold property in designated areas, which include most major communities on this platform (Marina, Downtown, Palm Jumeirah, JVC, Arabian Ranches and others)." },
    { group: "BUYING", question: "What are the total buyer costs?", answer: "Plan for the DLD transfer fee (4% of price, customarily split with the seller), agency commission (commonly 2%) and, with a mortgage, ~0.25% of the loan amount for registration plus admin fees. The mortgage calculator includes these." },
    { group: "OFF_PLAN", question: "Are off-plan payments protected?", answer: "Registered off-plan projects must use project-specific escrow accounts supervised under Dubai's escrow regulations, with withdrawals tied to certified construction progress. Confirm registration and escrow details before any payment." },
    { group: "INVESTMENT", question: "What rental yield should I expect?", answer: "Yields differ by community, unit type and strategy. The platform separates facts, assumptions and projections in every calculator: community yield figures carry source and methodology labels, and your own assumptions drive the scenario." },
    { group: "INVESTMENT", question: "Can you guarantee returns?", answer: "No. Investment Experts presents sourced data and transparent scenarios; projections are illustrative and never guaranteed. Any statement implying guaranteed returns should be reported to us." },
    { group: "INTERNATIONAL", question: "Can I buy remotely without visiting Dubai?", answer: "In most cases yes — identity verification and trustee processes support remote completion, with power of attorney where required. Our international-buyers guide details the workflow." },
    { group: "AI_ADVISOR", question: "How does the AI Advisor work?", answer: "The advisor searches real inventory through deterministic tools, cites approved knowledge sources for regulations and fees, and runs calculators rather than estimating arithmetic itself. When it cannot verify a fact it says so and offers a human handoff." },
    { group: "AI_ADVISOR", question: "Does the AI Advisor store my conversation?", answer: "Conversations are retained to improve continuity and to hand context to your advisor. You can request deletion through the privacy center at any time." },
    { group: "PRIVACY", question: "What data do you collect?", answer: "Essential platform operation data always; analytics, personalization and marketing only with your consent. Attribution context (how you arrived at an enquiry) is attached to leads you submit. Full details are in the privacy notice." },
  ];
}

function buildArticles(): {
  slug: string; title: string; excerpt: string; category: string; readingMinutes: number;
  image: string; body: string; sourceName: string; sourceUrl: string; tags: string[]; publishedDaysAgo: number;
}[] {
  return [
    {
      slug: "short-stay-vs-annual-rent",
      title: "Short-Stay vs Annual Rent: The Real Yield Trade-Off",
      excerpt: "Higher headline income from short-stay licensing comes with occupancy risk, operator fees and seasonality. A framework for deciding which strategy fits your unit — and your temperament.",
      category: "Rental strategy", readingMinutes: 7, image: "/images/properties/apartment-marina-living.jpg",
      tags: ["rental-strategy", "yield", "short-stay"],
      publishedDaysAgo: 3,
      body: `# Short-stay vs annual rent: the real yield trade-off

Short-stay licensing can lift headline income — and it can quietly destroy a year's return through vacancy and operator costs. The choice is strategy selection, not optimization.

## Where the income actually differs

**Annual rent** is a single contract, one set of transaction costs, and a known number at renewal. AED-per-day economics are lower, but so is the variance.

**Short-stay** grosses more per occupied night but pays for it: operator or management fees (commonly a meaningful share of revenue), higher utility and consumables load, furnishing amortization, and licensing compliance. The income that matters is net of all of it.

## The three questions that decide it

1. **Can the building license it?** Short-stay operation depends on the tower's permits and community rules — verify before pricing the strategy in.
2. **What does seasonality do to your carry cost?** A unit that sits empty through the shoulder months still incurs service charges and finance costs.
3. **Who operates it?** Self-managed short-stay is a part-time job; delegated operation is a fee structure. Neither is free.

## The honest comparison

Model both routes on the same unit with the platform's yield calculator: annual rent with realistic vacancy, versus short-stay with your best-evidence occupancy and the full operator fee stack. If the short-stay scenario only wins at occupancy you cannot evidence, the decision is made.

## When annual wins outright

- Your horizon includes a possible own-use or resale window — tenanted units sell with vacancy-timing constraints.
- You are remote and want zero operational surface.
- The building has no short-stay permit, which settles the question before it starts.

## When short-stay earns its complexity

- Prime, licensed towers in high-demand short-stay communities.
- You have an operator with transparent, audited statements.
- You can carry a weak season without forced selling.

_Sources: DLD rental contract series (production import); RERA short-stay licensing rules; Investment Experts advisory practice. Verified 2026-09. General information, not investment advice._`,
      sourceName: "RERA short-stay regulations / DLD rental index",
      sourceUrl: "https://dubailand.gov.ae/",
    },
    {
      slug: "service-charges-net-yield-decider",
      title: "Service Charges: The Line Item That Decides Net Yield",
      excerpt: "Two identical apartments in neighboring towers can differ by the equivalent of a full percentage point of yield — purely on service charges. How to read a service-charge schedule before you buy.",
      category: "Costs & fees", readingMinutes: 6, image: "/images/properties/apartment-jvc-interior.jpg",
      tags: ["service-charges", "net-yield", "due-diligence"],
      publishedDaysAgo: 8,
      body: `# Service charges: the line item that decides net yield

Gross yield gets the headlines; net yield pays the mortgage. Between the two sits one controllable, checkable line: the service charge.

## Why per-sqft rates vary so widely

Service charges reflect each building's real cost base: amenities (pools, gyms, concierge), cooling plant type and contract, elevator count, facade complexity, reserve-fund contributions and management overhead. Towers that look alike can run materially different annual per-sqft rates.

## What to ask for before you commit

1. **The current annual service-charge schedule** — total per sqft, and what it includes (especially chilling: district cooling vs inclusive).
2. **The three-year history** — steady, rising, or special levies? A history of special levies is a reserve-fund story.
3. **What is excluded** — parking, access cards, move-in fees, unit-level cooling caps.
4. **The reserve fund position** — underfunded reserves become tomorrow's levy.

## The yield arithmetic

On a mid-market apartment, the spread between a lean and a heavy service-charge regime can move net yield by a full percentage point or more — the same order of magnitude as a careful purchase-price negotiation. It deserves the same diligence.

The platform's yield calculator carries annual costs as an explicit input for exactly this reason: use the actual schedule, not a rule of thumb.

## Red flags in the disclosure

- Rates quoted "from" a figure without the current year's actual.
- No history available — ask why, in writing.
- Major plant (cooling, elevators) near end-of-life with a thin reserve fund.

_Sources: Building service-charge schedules (obtained per listing in production); DLD service-charge index; verified 2026-09. General information, not financial advice._`,
      sourceName: "DLD service charge index / developer disclosures",
      sourceUrl: "https://dubailand.gov.ae/",
    },
    {
      slug: "reading-payment-plans-like-a-lender",
      title: "Reading an Off-Plan Payment Plan Like a Lender",
      excerpt: "A payment schedule is a cash-flow commitment with construction risk attached. Four checks that turn a glossy plan into a decision-grade cash-flow model.",
      category: "Off-plan", readingMinutes: 6, image: "/images/projects/tower-render-1.jpg",
      tags: ["off-plan", "payment-plans", "cash-flow"],
      publishedDaysAgo: 14,
      body: `# Reading an off-plan payment plan like a lender

Payment plans are marketed as affordability. They should be underwritten as cash-flow: amounts, timing triggers, and what happens when the schedule slips.

## The anatomy that matters

Every plan reduces to four elements: the booking deposit, construction-linked installments (what % triggers each), the handover balance, and any post-handover tail. The platform's payment-plan calculator turns any of these into a dated cash-flow schedule — with the plan's verification status shown alongside.

## The four lender questions

1. **Trigger linkage:** are installments tied to certified construction milestones (the escrow-linked standard) or calendar dates? Calendar-linked plans front-load your risk if construction slips.
2. **Concentration at handover:** a large handover balance is a refinancing event. Lenders assess it; so should you.
3. **The tail:** post-handover balances are developer credit — price the risk of that credit, not just its convenience.
4. **Your own stress case:** what if handover moves two quarters late and your income changes meanwhile? If the plan only works on the developer's timetable, it is the developer's plan, not yours.

## Escrow linkage is the safety line

Registered projects hold buyer funds in project-specific escrow released against certified progress — the regulatory backstop that makes milestone-linked plans categorically safer than calendar ones. Confirm registration and escrow before comparing any numbers.

## A worked discipline

Run the schedule at three timings: the developer's stated plan, one quarter late, two quarters late. If scenario three forces a distressed sale, either negotiate the plan structure or pass on the unit.

_Sources: RERA escrow and project-registration regulations; developer payment-plan schedules as disclosed per project. Verified 2026-09. General information, not financial advice._`,
      sourceName: "RERA escrow regulations / developer schedules",
      sourceUrl: "https://dubailand.gov.ae/",
    },
  ];
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
