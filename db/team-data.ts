/**
 * Canonical VERIFIED team data (V3-02, V3 §11) — single source of truth.
 * User-supplied: name, designation, phone, WhatsApp-capability, group,
 * public-advisor flag, mirrored photo asset. NOTHING else is claimed:
 * no years, languages, specialties, bios, capacity or listing counts.
 *
 * Shared by scripts/v3-team-migration.ts (live migration) and db/seed.ts
 * (fresh-seed parity) so both produce the identical end-state.
 *
 * Rules encoded here:
 *  - members 19/23 carry no public designation (jobTitle "") — internal
 *    "No Team Assigned" is never displayed as a title;
 *  - members 24/25 have no phone — call/WhatsApp actions are omitted;
 *  - member 12 keeps a PK (+92) number — never reformatted as UAE;
 *  - `publicAdvisor` gates the /agents advisory directory.
 */

export type TeamDepartment = "leadership" | "sales" | "marketing" | "hr" | "admin" | "other";

export interface TeamMember {
  /** Stable slug (kebab-case name, unique across the set). */
  slug: string;
  name: string;
  /** Verified designation; "" when none is public (members 19/23). */
  jobTitle: string;
  /** Human-readable phone form as supplied (display only). */
  phoneDisplay: string | null;
  /** E.164 digits for tel: links. */
  phoneE164: string | null;
  /** E.164 digits for wa.me links (same as phone). */
  whatsappE164: string | null;
  department: TeamDepartment;
  publicAdvisor: boolean;
  /** Mirrored photo asset path. */
  photoUrl: string;
  /** Table order from the supplied sheet (1-based). */
  order: number;
}

export const TEAM_MEMBERS: TeamMember[] = [
  { order: 1, slug: "investment-experts", name: "Investment Experts", jobTitle: "Admin", phoneDisplay: "+971 52 743 8388", phoneE164: "+971527438388", whatsappE164: "+971527438388", department: "admin", publicAdvisor: false, photoUrl: "/images/team/member-01.jpg" },
  { order: 2, slug: "hammad-khan", name: "Hammad Khan", jobTitle: "Sales Manager", phoneDisplay: "+971 58 132 6676", phoneE164: "+971581326676", whatsappE164: "+971581326676", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-02.jpg" },
  { order: 3, slug: "muhammad-imran-khan", name: "Muhammad Imran Khan", jobTitle: "CEO", phoneDisplay: "+971 52 743 8388", phoneE164: "+971527438388", whatsappE164: "+971527438388", department: "leadership", publicAdvisor: false, photoUrl: "/images/team/member-03.jpg" },
  { order: 4, slug: "waheed-uz-zaman", name: "Waheed Uz Zaman", jobTitle: "Sales Manager", phoneDisplay: "+971 55 982 1786", phoneE164: "+971559821786", whatsappE164: "+971559821786", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-04.jpg" },
  { order: 5, slug: "sarah-shaheen", name: "Sarah Shaheen", jobTitle: "Marketing", phoneDisplay: "+971 52 743 8388", phoneE164: "+971527438388", whatsappE164: "+971527438388", department: "marketing", publicAdvisor: false, photoUrl: "/images/team/member-05.jpg" },
  { order: 6, slug: "laiba-shahzad", name: "Laiba Shahzad", jobTitle: "Sales Manager", phoneDisplay: "+971 55 228 5188", phoneE164: "+971552285188", whatsappE164: "+971552285188", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-06.jpg" },
  { order: 7, slug: "anushka-lalwani", name: "Anushka Lalwani", jobTitle: "Sales Manager", phoneDisplay: "+971 52 612 1003", phoneE164: "+971526121003", whatsappE164: "+971526121003", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-07.jpg" },
  { order: 8, slug: "muhammad-asif-malik", name: "Muhammad Asif Malik", jobTitle: "Sales Manager", phoneDisplay: "+971 58 822 4640", phoneE164: "+971588224640", whatsappE164: "+971588224640", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-08.jpg" },
  { order: 9, slug: "muniq-malik", name: "Muniq Malik", jobTitle: "Sales Manager", phoneDisplay: "+971 52 799 2280", phoneE164: "+971527992280", whatsappE164: "+971527992280", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-09.jpg" },
  { order: 10, slug: "rao-chohan", name: "Rao Chohan", jobTitle: "Sales Manager", phoneDisplay: "+971 55 422 9571", phoneE164: "+971554229571", whatsappE164: "+971554229571", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-10.jpg" },
  { order: 11, slug: "sajid-mehmood", name: "Sajid Mehmood", jobTitle: "Sales Manager", phoneDisplay: "+971 50 796 7637", phoneE164: "+971507967637", whatsappE164: "+971507967637", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-11.jpg" },
  { order: 12, slug: "salman-ahmed", name: "Salman Ahmed", jobTitle: "Sales Manager", phoneDisplay: "+92 332 368 1777", phoneE164: "+923323681777", whatsappE164: "+923323681777", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-12.jpg" },
  { order: 13, slug: "laila-shabbir", name: "Laila Shabbir", jobTitle: "HR", phoneDisplay: "+971 52 259 3695", phoneE164: "+971522593695", whatsappE164: "+971522593695", department: "hr", publicAdvisor: false, photoUrl: "/images/team/member-13.jpg" },
  { order: 14, slug: "moazzama-awan", name: "Moazzama Awan", jobTitle: "Sales Manager", phoneDisplay: "+971 58 591 8077", phoneE164: "+971585918077", whatsappE164: "+971585918077", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-14.jpg" },
  { order: 15, slug: "sarosh-iqbal", name: "Sarosh Iqbal", jobTitle: "Sales Manager", phoneDisplay: "+971 52 857 6024", phoneE164: "+971528576024", whatsappE164: "+971528576024", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-15.jpg" },
  { order: 16, slug: "atif", name: "Atif", jobTitle: "Sales Manager", phoneDisplay: "+971 52 775 0818", phoneE164: "+971527750818", whatsappE164: "+971527750818", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-16.jpg" },
  { order: 17, slug: "omais-jamal", name: "Omais Jamal", jobTitle: "Sales Manager", phoneDisplay: "+971 55 954 4363", phoneE164: "+971559544363", whatsappE164: "+971559544363", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-17.jpg" },
  { order: 18, slug: "syed-danish", name: "Syed Danish", jobTitle: "Sales Manager", phoneDisplay: "+971 55 450 5848", phoneE164: "+971554505848", whatsappE164: "+971554505848", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-18.jpg" },
  { order: 19, slug: "hrithik-bharadwaj", name: "Hrithik Bharadwaj", jobTitle: "", phoneDisplay: "+971 50 584 7946", phoneE164: "+971505847946", whatsappE164: "+971505847946", department: "other", publicAdvisor: false, photoUrl: "/images/team/member-19.jpg" },
  { order: 20, slug: "maysoon", name: "Maysoon", jobTitle: "Marketing", phoneDisplay: "+971 50 924 1020", phoneE164: "+971509241020", whatsappE164: "+971509241020", department: "marketing", publicAdvisor: false, photoUrl: "/images/team/member-20.jpg" },
  { order: 21, slug: "abdulaziz", name: "Abdulaziz", jobTitle: "Sales Manager", phoneDisplay: "+971 52 278 5669", phoneE164: "+971522785669", whatsappE164: "+971522785669", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-21.jpg" },
  { order: 22, slug: "habeeb", name: "Habeeb", jobTitle: "Sales Manager", phoneDisplay: "+971 52 255 7860", phoneE164: "+971522557860", whatsappE164: "+971522557860", department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-22.jpg" },
  { order: 23, slug: "ayaz", name: "Ayaz", jobTitle: "", phoneDisplay: "+971 55 416 3052", phoneE164: "+971554163052", whatsappE164: "+971554163052", department: "other", publicAdvisor: false, photoUrl: "/images/team/member-23.jpg" },
  { order: 24, slug: "sumbul", name: "Sumbul", jobTitle: "Marketing", phoneDisplay: null, phoneE164: null, whatsappE164: null, department: "marketing", publicAdvisor: false, photoUrl: "/images/team/member-24.jpg" },
  { order: 25, slug: "tanzeel-uz-zaman", name: "Tanzeel Uz Zaman", jobTitle: "Sales Manager", phoneDisplay: null, phoneE164: null, whatsappE164: null, department: "sales", publicAdvisor: true, photoUrl: "/images/team/member-25.jpg" },
];

/**
 * Central advisory desk fallback (V3 §54) — non-person contact record.
 * Every listing is attributed here until a verified listing→advisor
 * mapping exists (prevents false attribution to real employees).
 */
export const ADVISORY_DESK = {
  slug: "advisory-desk",
  name: "Investment Experts Advisory Desk",
  jobTitle: "Advisory Desk",
  phoneDisplay: "+971 50 221 3802",
  phoneE164: "+971502213802",
  whatsappE164: "+971502213802",
  department: "sales" as TeamDepartment,
  publicAdvisor: true,
  photoUrl: "/brand/investment-experts-logo.png",
  sortWeight: 100,
} as const;

/** Fictional demo agents to purge (V1 seed fixtures — never real people). */
export const FICTIONAL_AGENT_SLUGS = [
  "layla-haddad",
  "omar-farouk",
  "priya-sharma",
  "dmitri-volkov",
  "sara-ahmadi",
  "james-connolly",
] as const;
