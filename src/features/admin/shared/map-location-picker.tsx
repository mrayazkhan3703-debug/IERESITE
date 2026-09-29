"use client";
import { Link } from "@/lib/router";
import { Input } from "@/components/ui/input";
import { MapPin } from "lucide-react";

export function MapLocationPicker({ lat, lng, onLatitudeChange, onLongitudeChange }: {
  lat: string; lng: string; onLatitudeChange: (value: string) => void; onLongitudeChange: (value: string) => void;
}) {
  const hasCoordinates = lat.trim() !== "" && lng.trim() !== "" && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  return <div className="space-y-2">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block space-y-1.5 text-sm font-medium">Latitude<Input required type="number" min="-90" max="90" step="any" value={lat} onChange={(event) => onLatitudeChange(event.target.value)} /></label>
      <label className="block space-y-1.5 text-sm font-medium">Longitude<Input required type="number" min="-180" max="180" step="any" value={lng} onChange={(event) => onLongitudeChange(event.target.value)} /></label>
    </div>
    {hasCoordinates && <Link to="/properties/map" query={{ z: "14", c: `${lat},${lng}` }} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-strong underline underline-offset-2"><MapPin className="h-3.5 w-3.5" aria-hidden />Preview this location on the public map</Link>}
  </div>;
}
