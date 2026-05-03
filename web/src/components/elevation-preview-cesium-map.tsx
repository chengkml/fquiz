"use client";

import { Alert, Empty, Spin } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import { reloadOnceOnChunkError } from "@/lib/chunk-error";
import type { ElevationDatasetPreviewCell, ElevationDatasetPreviewPoint } from "@/types/auth";

type ElevationPreviewCesiumMapProps = {
  points: ElevationDatasetPreviewPoint[];
  cells?: ElevationDatasetPreviewCell[];
  loading?: boolean;
};

type CesiumNamespace = typeof import("cesium");

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}

function pointColorByAltitude(altitude: number, minAltitude: number, maxAltitude: number): string {
  if (maxAltitude <= minAltitude) return "#38bdf8";
  const ratio = (altitude - minAltitude) / (maxAltitude - minAltitude);
  if (ratio >= 0.85) return "#dc2626";
  if (ratio >= 0.65) return "#f97316";
  if (ratio >= 0.45) return "#eab308";
  if (ratio >= 0.25) return "#84cc16";
  return "#38bdf8";
}

function pointSizeByAltitude(altitude: number, minAltitude: number, maxAltitude: number): number {
  if (maxAltitude <= minAltitude) return 6;
  const ratio = (altitude - minAltitude) / (maxAltitude - minAltitude);
  if (ratio >= 0.85) return 11;
  if (ratio >= 0.65) return 9;
  if (ratio >= 0.45) return 8;
  if (ratio >= 0.25) return 7;
  return 6;
}

function formatErrorMessage(candidate: unknown): string {
  if (candidate instanceof Error && candidate.message) return candidate.message;
  return "Cesium 初始化失败，请检查静态资源是否已同步。";
}

export function ElevationPreviewCesiumMap({
  points,
  cells = [],
  loading = false,
}: ElevationPreviewCesiumMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<import("cesium").Viewer | null>(null);
  const cesiumRef = useRef<CesiumNamespace | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const safePoints = useMemo(
    () =>
      points.filter(
        (item) =>
          Number.isFinite(item.longitude)
          && Number.isFinite(item.latitude)
          && Number.isFinite(item.altitude_m)
          && item.longitude >= -180
          && item.longitude <= 180
          && item.latitude >= -90
          && item.latitude <= 90,
      ),
    [points],
  );
  const safeCells = useMemo(
    () =>
      cells.filter(
        (item) =>
          Number.isFinite(item.min_longitude)
          && Number.isFinite(item.max_longitude)
          && Number.isFinite(item.min_latitude)
          && Number.isFinite(item.max_latitude)
          && Number.isFinite(item.altitude_m)
          && item.min_longitude < item.max_longitude
          && item.min_latitude < item.max_latitude
          && item.min_longitude >= -180
          && item.max_longitude <= 180
          && item.min_latitude >= -90
          && item.max_latitude <= 90,
      ),
    [cells],
  );

  const altitudeRange = useMemo(() => {
    if (safeCells.length === 0 && safePoints.length === 0) {
      return { min: 0, max: 0 };
    }
    const source = safeCells.length > 0 ? safeCells.map((item) => item.altitude_m) : safePoints.map((item) => item.altitude_m);
    let min = source[0];
    let max = source[0];
    for (const altitude of source) {
      if (altitude < min) min = altitude;
      if (altitude > max) max = altitude;
    }
    return { min, max };
  }, [safeCells, safePoints]);

  useEffect(() => {
    let cancelled = false;
    async function initViewer() {
      if (!containerRef.current || viewerRef.current) return;
      try {
        window.CESIUM_BASE_URL = "/cesium";
        const Cesium = await import("cesium");
        if (cancelled || !containerRef.current) return;

        const viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          baseLayer: false,
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: true,
          navigationHelpButton: false,
          sceneModePicker: false,
          selectionIndicator: false,
          skyBox: false,
          skyAtmosphere: false,
          timeline: false,
          shouldAnimate: false,
        });
        viewer.scene.globe.depthTestAgainstTerrain = false;
        viewer.scene.globe.showGroundAtmosphere = false;
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0f172a");
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#020617");
        const creditContainer = viewer.cesiumWidget.creditContainer as HTMLElement | null;
        if (creditContainer) {
          creditContainer.style.display = "none";
        }

        viewerRef.current = viewer;
        cesiumRef.current = Cesium;
        setReady(true);
        setError("");
      } catch (candidate) {
        if (reloadOnceOnChunkError(candidate)) {
          return;
        }
        setError(formatErrorMessage(candidate));
      }
    }

    void initViewer();
    return () => {
      cancelled = true;
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
      }
      viewerRef.current = null;
      cesiumRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || !ready) {
      return;
    }
    viewer.entities.removeAll();
    if (safeCells.length === 0 && safePoints.length === 0) {
      return;
    }

    const positions: import("cesium").Cartesian3[] = [];
    if (safeCells.length > 0) {
      for (let index = 0; index < safeCells.length; index += 1) {
        const cell = safeCells[index];
        const centerLon = (cell.min_longitude + cell.max_longitude) / 2;
        const centerLat = (cell.min_latitude + cell.max_latitude) / 2;
        const centerAltitude = cell.altitude_m;
        const position = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, centerAltitude);
        positions.push(position);
        const color = Cesium.Color.fromCssColorString(
          pointColorByAltitude(centerAltitude, altitudeRange.min, altitudeRange.max),
        ).withAlpha(0.82);

        viewer.entities.add({
          id: `elevation-cell-${index}`,
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(
              cell.min_longitude,
              cell.min_latitude,
              cell.max_longitude,
              cell.max_latitude,
            ),
            material: color,
            outline: false,
            height: centerAltitude,
          },
          description: `
            <div style="line-height:1.7;">
              <div><strong>高程(m)：</strong>${centerAltitude.toFixed(3)}</div>
              <div><strong>边界：</strong>${cell.min_longitude.toFixed(4)}, ${cell.min_latitude.toFixed(4)} ~ ${cell.max_longitude.toFixed(4)}, ${cell.max_latitude.toFixed(4)}</div>
            </div>
          `,
        });
      }
    } else {
      for (let index = 0; index < safePoints.length; index += 1) {
        const point = safePoints[index];
        const position = Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.altitude_m);
        positions.push(position);
        const color = pointColorByAltitude(point.altitude_m, altitudeRange.min, altitudeRange.max);
        const size = pointSizeByAltitude(point.altitude_m, altitudeRange.min, altitudeRange.max);

        viewer.entities.add({
          id: `elevation-point-${index}`,
          position,
          point: {
            pixelSize: size,
            color: Cesium.Color.fromCssColorString(color),
            outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
            outlineWidth: 1.0,
          },
          description: `
            <div style="line-height:1.7;">
              <div><strong>经度：</strong>${point.longitude.toFixed(6)}</div>
              <div><strong>纬度：</strong>${point.latitude.toFixed(6)}</div>
              <div><strong>高程(m)：</strong>${point.altitude_m.toFixed(3)}</div>
            </div>
          `,
        });
      }
    }

    if (positions.length > 0) {
      const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
      void viewer.camera.flyToBoundingSphere(boundingSphere, {
        duration: 0.8,
        offset: new Cesium.HeadingPitchRange(0, -0.6, Math.max(1200, boundingSphere.radius * 2.4)),
      });
    }
  }, [altitudeRange.max, altitudeRange.min, ready, safeCells, safePoints]);

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message={`预览地图加载失败：${error}`}
      />
    );
  }

  if (safeCells.length === 0 && safePoints.length === 0 && !loading) {
    return <Empty description="暂无可展示的高程预览点。" />;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-500">
        颜色由蓝到红表示高程由低到高；栅格数据优先展示地形网格色带，点位模式用于点集数据。
      </div>
      <div ref={containerRef} className="h-[520px] w-full overflow-hidden rounded-md border border-slate-200 bg-slate-100" />
      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Spin size="small" />
          预览数据加载中...
        </div>
      )}
    </div>
  );
}
