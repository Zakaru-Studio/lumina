/**
 * Location editor modal, opened from the Lightbox. Three ways to set a photo's
 * coordinate, all converging on a single lat/lon: click/drag a pin on an
 * offline world map, type the coordinates directly, or enter a place name
 * (city / region / country) and forward-geocode it.
 *
 * Saving persists the coordinate to the catalog (via the caller's `onSubmit`)
 * and, when the place fields were touched, stores the entered names so they
 * stick and re-appear on next open. "Remove" clears the coordinate.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, MapPin, Search } from "lucide-react";

import { LocationPicker } from "@/components/map/LocationPicker";
import { reverseGeocode } from "@/components/map/geo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  useAddressSearch,
  useGeocodeSearch,
  usePlace,
  useSetPlace,
} from "@/hooks/useMapPhotos";
import { cn } from "@/lib/utils";
import type { GeoSearchResult } from "@/types";

/** Round to ~1 m for display. */
function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/** Parse the two coordinate fields into a valid `[lat, lon]`, or null. */
function parseCoords(latStr: string, lonStr: string): { lat: number; lon: number } | null {
  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export interface LocationEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The photo's current coordinate, or null when it has none. */
  lat: number | null;
  lon: number | null;
  /** Called with the chosen coordinate, or `(null, null)` to clear it. */
  onSubmit: (lat: number | null, lon: number | null) => void;
  pending?: boolean;
}

export function LocationEditor({ open, onOpenChange, lat, lon, onSubmit, pending }: LocationEditorProps) {
  const { t } = useTranslation();
  const [latStr, setLatStr] = useState("");
  const [lonStr, setLonStr] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  // True once the user touches a place field, so async seeding never clobbers it.
  const [placeDirty, setPlaceDirty] = useState(false);

  const search = useGeocodeSearch();
  const setPlace = useSetPlace();
  // Any place the user previously saved for this photo's coordinate.
  const stored = usePlace(open ? lat : null, open ? lon : null);

  // Address search (OSM-like): a debounced free-text lookup with a results
  // dropdown. `address` is the live input; `addressTerm` is the debounced query.
  const [address, setAddress] = useState("");
  const [addressTerm, setAddressTerm] = useState("");
  const [addrFocused, setAddrFocused] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setAddressTerm(address), 500);
    return () => window.clearTimeout(id);
  }, [address]);
  const addr = useAddressSearch(addressTerm);
  const results = addr.data ?? [];
  const showResults = addrFocused && address.trim().length >= 3;

  // Re-seed coordinates + clear the place fields each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setLatStr(lat != null ? String(round5(lat)) : "");
    setLonStr(lon != null ? String(round5(lon)) : "");
    setCity("");
    setRegion("");
    setCountry("");
    setPlaceDirty(false);
    setAddress("");
    setAddressTerm("");
    setAddrFocused(false);
  }, [open, lat, lon]);

  /** Pick an address-search result: drop the pin and adopt its place names. */
  const pickResult = (r: GeoSearchResult) => {
    onPick(r.lat, r.lon);
    setCity(r.place.city ?? "");
    setRegion(r.place.region ?? "");
    setCountry(r.place.country ?? "");
    setPlaceDirty(true);
    setAddress("");
    setAddressTerm("");
    setAddrFocused(false);
  };

  // Seed the place fields from the saved place (preferred) or the offline
  // gazetteer, once the lookup settles — unless the user has started typing.
  useEffect(() => {
    if (!open || placeDirty || !stored.isSuccess) return;
    if (stored.data) {
      setCity(stored.data.city ?? "");
      setRegion(stored.data.region ?? "");
      setCountry(stored.data.country ?? "");
    } else if (lat != null && lon != null) {
      const off = reverseGeocode(lat, lon);
      setCity(off.city ?? "");
      setRegion("");
      setCountry(off.country ?? "");
    }
  }, [open, placeDirty, stored.isSuccess, stored.data, lat, lon]);

  const coords = parseCoords(latStr, lonStr);

  /** Reflect a coordinate (from the map pin) into the input fields. */
  const onPick = (la: number, lo: number) => {
    setLatStr(String(round5(la)));
    setLonStr(String(round5(lo)));
  };

  const editCity = (v: string) => {
    setCity(v);
    setPlaceDirty(true);
  };
  const editRegion = (v: string) => {
    setRegion(v);
    setPlaceDirty(true);
  };
  const editCountry = (v: string) => {
    setCountry(v);
    setPlaceDirty(true);
  };

  const hasPlaceQuery = Boolean(city.trim() || region.trim() || country.trim());

  /** Forward-geocode the typed place and drop the pin on the best match. Only
   * fills the place fields that are still empty, so it never overwrites input. */
  const locate = () => {
    const query = [city, region, country]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");
    if (!query) return;
    search.mutate(query, {
      onSuccess: (res) => {
        if (!res) {
          toast.error(t("locationEditor.notFound"));
          return;
        }
        onPick(res.lat, res.lon);
        setCity((c) => c.trim() || res.place.city || "");
        setRegion((r) => r.trim() || res.place.region || "");
        setCountry((c) => c.trim() || res.place.country || "");
        setPlaceDirty(true);
      },
    });
  };

  const onPlaceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      locate();
    }
  };

  const submit = () => {
    if (!coords) return;
    // Persist the entered place for this coordinate so the label sticks.
    if (placeDirty) {
      setPlace.mutate({
        lat: coords.lat,
        lon: coords.lon,
        city: city.trim() || null,
        region: region.trim() || null,
        country: country.trim() || null,
      });
    }
    onSubmit(coords.lat, coords.lon);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("locationEditor.title")}</DialogTitle>
          <DialogDescription>{t("locationEditor.hint")}</DialogDescription>
        </DialogHeader>

        <LocationPicker className="h-96" lat={coords?.lat ?? null} lon={coords?.lon ?? null} onChange={onPick} />

        {/* Address search — type an address, pick a match to drop the pin. */}
        <div className="relative">
          <div className="relative">
            {addr.isFetching ? (
              <Loader2 className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : (
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            )}
            <Input
              className="pl-8"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onFocus={() => setAddrFocused(true)}
              onBlur={() => window.setTimeout(() => setAddrFocused(false), 150)}
              placeholder={t("locationEditor.searchAddress")}
            />
          </div>
          {showResults && results.length > 0 ? (
            <ul className="absolute inset-x-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-lg">
              {results.map((r, i) => (
                <li key={`${r.lat},${r.lon},${i}`}>
                  <button
                    type="button"
                    // onMouseDown fires before the input's blur, so the pick isn't lost.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickResult(r);
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left",
                      "hover:bg-accent focus:bg-accent focus:outline-none",
                    )}
                  >
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="line-clamp-2 text-foreground">{r.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : showResults && addressTerm.trim().length >= 3 && !addr.isFetching ? (
            <div className="absolute inset-x-0 z-50 mt-1 rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-lg">
              {t("locationEditor.noResults")}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">{t("locationEditor.latitude")}</Label>
            <Input
              inputMode="decimal"
              value={latStr}
              onChange={(e) => setLatStr(e.target.value)}
              placeholder="0.00000"
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">{t("locationEditor.longitude")}</Label>
            <Input
              inputMode="decimal"
              value={lonStr}
              onChange={(e) => setLonStr(e.target.value)}
              placeholder="0.00000"
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("locationEditor.findByPlace")}
          </Label>
          <div className="grid grid-cols-3 gap-2">
            <Input value={city} onChange={(e) => editCity(e.target.value)} onKeyDown={onPlaceKeyDown} placeholder={t("locationEditor.city")} />
            <Input value={region} onChange={(e) => editRegion(e.target.value)} onKeyDown={onPlaceKeyDown} placeholder={t("locationEditor.region")} />
            <Input value={country} onChange={(e) => editCountry(e.target.value)} onKeyDown={onPlaceKeyDown} placeholder={t("locationEditor.country")} />
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="w-full gap-1.5"
            onClick={locate}
            disabled={search.isPending || !hasPlaceQuery}
          >
            <Search className="h-4 w-4" />
            {search.isPending ? t("locationEditor.locating") : t("locationEditor.locate")}
          </Button>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => onSubmit(null, null)}
            disabled={pending || (lat == null && lon == null)}
          >
            {t("locationEditor.remove")}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} disabled={!coords || pending}>
              {t("common.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
