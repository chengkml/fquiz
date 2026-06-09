export type RouteTowerInput = {
  id: string;
  seq_no: number;
  tower_no: string;
  longitude: number | null;
  latitude: number | null;
  altitude_m: number | null;
  risk_level: string | null;
};

export type TowerGeoPoint = {
  id: string;
  seqNo: number;
  towerNo: string;
  longitude: number;
  latitude: number;
  altitudeM: number;
  riskLevel: string | null;
};

export type RouteSegment = {
  key: string;
  points: TowerGeoPoint[];
};

const DEFAULT_ALTITUDE_M = 0;

export function hasValidGeo(tower: Pick<RouteTowerInput, "longitude" | "latitude">): boolean {
  if (tower.longitude === null || tower.latitude === null) return false;
  if (Number.isNaN(tower.longitude) || Number.isNaN(tower.latitude)) return false;
  if (tower.longitude < -180 || tower.longitude > 180) return false;
  if (tower.latitude < -90 || tower.latitude > 90) return false;
  return true;
}

function toTowerGeoPoint(tower: RouteTowerInput): TowerGeoPoint {
  return {
    id: tower.id,
    seqNo: tower.seq_no,
    towerNo: tower.tower_no,
    longitude: tower.longitude ?? 0,
    latitude: tower.latitude ?? 0,
    altitudeM: tower.altitude_m ?? DEFAULT_ALTITUDE_M,
    riskLevel: tower.risk_level,
  };
}

export function collectTowerGeoPoints(towers: RouteTowerInput[]): TowerGeoPoint[] {
  return towers.filter(hasValidGeo).map(toTowerGeoPoint);
}

export function buildRouteSegments(towers: RouteTowerInput[]): RouteSegment[] {
  const segments: RouteSegment[] = [];
  let current: TowerGeoPoint[] = [];
  let segmentIndex = 0;

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    segments.push({
      key: `${current[0].id}-${segmentIndex}`,
      points: current,
    });
    current = [];
    segmentIndex += 1;
  };

  towers.forEach((tower) => {
    if (!hasValidGeo(tower)) {
      flush();
      return;
    }
    current.push(toTowerGeoPoint(tower));
  });

  flush();
  return segments;
}
