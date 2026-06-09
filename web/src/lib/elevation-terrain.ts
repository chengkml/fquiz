import type { ElevationDatasetSummary, ElevationTerrainBounds, LineTowerSummary } from "@/types/auth";

export type ElevationTerrainRenderState = "ready" | "processing" | "failed" | "fallback";

export function getElevationTerrainRenderState(dataset: Pick<
  ElevationDatasetSummary,
  "terrain_status" | "terrain_url_template"
>): ElevationTerrainRenderState {
  if (dataset.terrain_status === "ready" && dataset.terrain_url_template) {
    return "ready";
  }
  if (dataset.terrain_status === "pending" || dataset.terrain_status === "processing") {
    return "processing";
  }
  if (dataset.terrain_status === "failed") {
    return "failed";
  }
  return "fallback";
}

export function countLineTowersOutsideTerrainBounds(
  towers: Pick<LineTowerSummary, "longitude" | "latitude">[],
  bounds: ElevationTerrainBounds | null,
): number {
  if (!bounds) {
    return 0;
  }
  let count = 0;
  for (const tower of towers) {
    if (tower.longitude === null || tower.latitude === null) {
      continue;
    }
    if (
      tower.longitude < bounds.west
      || tower.longitude > bounds.east
      || tower.latitude < bounds.south
      || tower.latitude > bounds.north
    ) {
      count += 1;
    }
  }
  return count;
}

export function getElevationTerrainLayerUrl(dataset: Pick<
  ElevationDatasetSummary,
  "id" | "terrain_metadata"
> | null): string | null {
  if (!dataset) {
    return null;
  }
  const candidate = dataset.terrain_metadata?.layer_url;
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate.trim().replace(/\/layer\.json$/, "");
  }
  return `/api/v1/elevation/datasets/${dataset.id}/terrain`;
}
