#!/bin/bash
# Demo media library generation (clearly-labeled development fixtures — ADR-010)
# Uses z-ai CLI image generation. Idempotent: skips existing files.
set -u
DIR="/home/z/my-project/public/images"
mkdir -p "$DIR/properties" "$DIR/projects" "$DIR/communities" "$DIR/brand"

gen() {
  local file="$1"; shift
  local prompt="$1"; shift
  local size="${1:-1344x768}"
  if [ -s "$file" ]; then echo "skip $file"; return 0; fi
  z-ai image -p "$prompt" -o "$file" -s "$size" >/dev/null 2>&1 && echo "ok $file" || echo "FAIL $file"
}

# Brand / hero
gen "$DIR/brand/hero-skyline.jpg" "Dubai skyline at golden dusk viewed across the water, Burj Khalifa silhouette, warm amber light, cinematic wide composition, architectural photography, high quality, detailed" "1344x768" &
gen "$DIR/brand/about-office.jpg" "Elegant modern real estate advisory office interior in Dubai, floor to ceiling windows with city view, warm neutral tones, brass details, editorial interior photography" "1344x768" &
wait

# Communities (aerial/context views)
gen "$DIR/communities/dubai-marina.jpg" "Dubai Marina aerial view of towers and yacht harbour at dusk, blue hour cityscape photography, high quality" "1344x768" &
gen "$DIR/communities/downtown-dubai.jpg" "Downtown Dubai with Burj Khalifa and fountain at dusk, urban landscape photography, high quality" "1344x768" &
gen "$DIR/communities/palm-jumeirah.jpg" "Aerial view of Palm Jumeirah island Dubai with beachfront villas, golden hour, drone photography, high quality" "1344x768" &
gen "$DIR/communities/business-bay.jpg" "Business Bay Dubai canal-side modern towers, daytime architectural photography, high quality" "1344x768" &
gen "$DIR/communities/jvc.jpg" "Jumeirah Village Circle Dubai residential community with low rise buildings and palm trees, warm afternoon light, high quality" "1344x768" &
gen "$DIR/communities/arabian-ranches.jpg" "Arabian Ranches Dubai desert-side villa community with landscaped streets and trees, golden hour, high quality" "1344x768" &
gen "$DIR/communities/emirates-hills.jpg" "Emirates Hills Dubai premier mansion district, grand contemporary villas beside Montgomerie golf course fairways, lush mature landscaping, tree-lined private lanes, golden hour drone photography, high quality" "1344x768" &
gen "$DIR/communities/dubai-hills-estate.jpg" "Dubai Hills Estate master-planned green community aerial view, contemporary villas around championship golf course, central park and tree-lined boulevards, golden hour drone photography, high quality" "1344x768" &
gen "$DIR/communities/jumeirah-village-circle.jpg" "Jumeirah Village Circle Dubai suburban community aerial view, circular layout of townhouses and mid-rise apartment blocks with community parks and palm trees, warm afternoon light, drone photography, high quality" "1344x768" &
wait

# Apartments
gen "$DIR/properties/apartment-marina-living.jpg" "Luxury Dubai Marina apartment living room with floor to ceiling windows overlooking yachts and towers, contemporary interior design, warm neutral palette, editorial real estate photography, high quality" "1344x768" &
gen "$DIR/properties/apartment-marina-bedroom.jpg" "Elegant apartment bedroom with Marina view through sheer curtains, soft morning light, luxury hotel style, editorial photography" "1344x768" &
gen "$DIR/properties/apartment-downtown-interior.jpg" "Modern Downtown Dubai apartment interior, open plan living area with city skyline view, refined contemporary design, editorial photography" "1344x768" &
gen "$DIR/properties/apartment-bay-interior.jpg" "Sleek Business Bay apartment interior with canal view, neutral tones, marble and wood, architectural digest style photography" "1344x768" &
gen "$DIR/properties/apartment-jvc-interior.jpg" "Bright modern JVC apartment living room, affordable luxury finish, natural light, real estate photography" "1344x768" &
gen "$DIR/properties/apartment-beach-living.jpg" "Beachfront Dubai apartment living room with panoramic sea view, light coastal luxury interior, editorial photography" "1344x768" &
wait

# Villas / townhouses
gen "$DIR/properties/villa-palm-exterior.jpg" "Contemporary luxury beachfront villa on Palm Jumeirah Dubai at golden hour, infinity pool, palm trees, architectural photography, high quality" "1344x768" &
gen "$DIR/properties/villa-palm-pool.jpg" "Luxury villa private infinity pool terrace overlooking the sea at dusk, Dubai, resort style, editorial photography" "1344x768" &
gen "$DIR/properties/villa-hills-exterior.jpg" "Grand modern villa in Emirates Hills Dubai with landscaped garden and driveway, warm dusk light, architectural photography" "1344x768" &
gen "$DIR/properties/villa-ranches-exterior.jpg" "Elegant Arabian Ranches family villa exterior with desert landscaping, warm evening light, high quality" "1344x768" &
gen "$DIR/properties/townhouse-exterior.jpg" "Modern Mediterranean style townhouse in Dubai community with front garden, warm afternoon light, real estate photography" "1344x768" &
gen "$DIR/properties/penthouse-terrace.jpg" "Luxury duplex penthouse rooftop terrace in Dubai Marina with skyline view, outdoor lounge, dusk, editorial photography" "1344x768" &
wait

# Projects (renders)
gen "$DIR/projects/tower-render-1.jpg" "Architectural render of a sleek modern residential tower with glass facade and stepped terraces, Dubai waterfront, dusk visualization, high quality" "1344x768" &
gen "$DIR/projects/tower-render-2.jpg" "Architectural visualization of luxury twin residential towers with podium amenities, landscaped plaza, daylight render, high quality" "1344x768" &
gen "$DIR/projects/villas-render.jpg" "Master plan render of boutique waterfront villa community with lagoons, palm landscaping, Dubai style development visualization" "1344x768" &
gen "$DIR/projects/waterfront-render.jpg" "Waterfront mixed-use development render with marina promenade, residential towers and beach club, golden hour visualization" "1344x768" &
gen "$DIR/projects/tower-render-3.jpg" "Brutalist-inspired luxury residential tower render with vertical gardens and sky gardens, contemporary architectural visualization" "1344x768" &
gen "$DIR/projects/hills-development.jpg" "Desert hillside gated villa community development render with contemporary desert architecture, Dubai, golden hour" "1344x768" &
wait

# Floor plan style
gen "$DIR/brand/floorplan-sample.jpg" "Clean minimalist 2 bedroom apartment floor plan drawing, architectural blueprint style with room labels, top view, white background, crisp lines" "1152x864" &

# Lifestyle / extras
gen "$DIR/brand/beach-lifestyle.jpg" "Kite Beach Dubai lifestyle at golden hour, people walking, skyline in distance, travel photography, high quality" "1344x768" &
wait

echo "DONE"
