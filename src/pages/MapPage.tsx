import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin, X } from "lucide-react";

import { EmptyState } from "@/components/common/EmptyState";
import { Lightbox } from "@/components/library/Lightbox";
import { MapView } from "@/components/map/MapView";
import type { Cluster } from "@/components/map/cluster";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClusterPhotos, useMapPhotos } from "@/hooks/useMapPhotos";
import { thumbnailSrc } from "@/lib/api";
import { formatDate } from "@/lib/format";

/**
 * Map view: every geotagged photo in the catalog plotted on a fully-offline,
 * stylized world map. Clicking a cluster opens an inspector panel of its photos;
 * clicking a photo there opens the shared Lightbox. No map tiles are ever
 * fetched — coordinates stay on the machine.
 */
export function MapPage() {
  const { t } = useTranslation();
  const { data: points = [], isLoading } = useMapPhotos();
  const [selected, setSelected] = useState<Cluster | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Full detail for the selected cluster's photos (for thumbnails + Lightbox).
  const selectedIds = useMemo(() => (selected ? selected.points.map((p) => p.id) : []), [selected]);
  const clusterPhotos = useClusterPhotos(selectedIds);

  const closePanel = () => {
    setSelected(null);
    setLightboxIndex(null);
  };

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <Header count={null} />
        <div className="flex-1 p-6">
          <Skeleton className="h-full w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <EmptyState
        icon={<MapPin className="h-6 w-6" />}
        title={t("mapPage.empty.title")}
        description={t("mapPage.empty.description")}
      />
    );
  }

  const expected = selected?.points.length ?? 0;

  return (
    <div className="relative flex h-full flex-col">
      <Header count={points.length} />

      <div className="relative min-h-0 flex-1">
        <MapView points={points} selectedId={selected?.id ?? null} onSelect={setSelected} />

        {/* Cluster inspector. */}
        {selected ? (
          <aside className="absolute inset-y-0 right-0 z-10 flex w-80 flex-col bg-card/85 backdrop-blur-md shadow-xl animate-fade-in">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex flex-col">
                <h2 className="text-sm font-semibold text-foreground">
                  {t("mapPage.photosHere", { count: expected })}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {clusterCoords(selected, t)}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label={t("common.close")} onClick={closePanel}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
              <div className="grid grid-cols-3 gap-2">
                {clusterPhotos.map((photo, i) => {
                  const src = thumbnailSrc(photo);
                  return (
                    <button
                      key={photo.id}
                      type="button"
                      aria-label={photo.filename}
                      title={`${photo.filename} · ${formatDate(photo.takenAt)}`}
                      onClick={() => setLightboxIndex(i)}
                      className="group relative aspect-square overflow-hidden rounded-lg bg-muted ring-offset-2 ring-offset-card transition hover:ring-2 hover:ring-primary"
                    >
                      {src ? (
                        <img
                          src={src}
                          alt={photo.filename}
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                          className="h-full w-full object-cover transition group-hover:scale-105"
                        />
                      ) : null}
                    </button>
                  );
                })}
                {/* Skeletons for detail still loading. */}
                {Array.from({ length: Math.max(0, expected - clusterPhotos.length) }).map((_, i) => (
                  <Skeleton key={`s-${i}`} className="aspect-square rounded-lg" />
                ))}
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      <Lightbox
        ids={clusterPhotos.map((p) => p.id)}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onIndexChange={setLightboxIndex}
        getPhoto={(i) => clusterPhotos[i]}
      />
    </div>
  );
}

/** Page header with the geotagged-photo count. */
function Header({ count }: { count: number | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t("nav.map")}</h1>
        <p className="text-xs text-muted-foreground">
          {count === null
            ? t("mapPage.loadingPlaces")
            : t("mapPage.geotaggedCount", { count, formattedCount: count.toLocaleString() })}
        </p>
      </div>
    </div>
  );
}

/** A rough "lat, lon" label from the cluster's representative (first) member. */
function clusterCoords(cluster: Cluster, t: (key: string) => string): string {
  const p = cluster.points[0];
  const lat = Math.abs(p.gpsLat).toFixed(3);
  const lon = Math.abs(p.gpsLon).toFixed(3);
  const ns = p.gpsLat >= 0 ? t("mapPage.compass.north") : t("mapPage.compass.south");
  const ew = p.gpsLon >= 0 ? t("mapPage.compass.east") : t("mapPage.compass.west");
  return `${lat}° ${ns}, ${lon}° ${ew}`;
}
