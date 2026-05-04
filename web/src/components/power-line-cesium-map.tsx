"use client";

import { AimOutlined, MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Empty, Spin, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { reloadOnceOnChunkError } from "@/lib/chunk-error";
import type { LineTowerSummary } from "@/types/auth";

type PowerLineCesiumMapProps = {
  lineCode?: string;
  lineName?: string;
  towers: LineTowerSummary[];
  loading?: boolean;
  height?: number;
};

type CesiumNamespace = typeof import("cesium");

type TowerGeoPoint = {
  id: string;
  seqNo: number;
  towerNo: string;
  longitude: number;
  latitude: number;
  altitudeM: number;
  riskLevel: string | null;
};

type RouteSegment = {
  key: string;
  points: TowerGeoPoint[];
};

type RouteViewState = {
  boundingSphere: import("cesium").BoundingSphere;
  range: number;
};

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}

const DEFAULT_MAP_HEIGHT = 560;
const DEFAULT_ALTITUDE_M = 0;
const MIN_CAMERA_RANGE = 1500;
const MIN_ZOOM_STEP_RANGE = 300;
const DEFAULT_POINT_COLOR = "#38bdf8";
const RISK_COLOR_BY_LEVEL: Record<string, string> = {
  "1": "#22c55e",
  "2": "#f59e0b",
  "3": "#ef4444",
};

function normalizeRiskLevel(value: string | null): string {
  const text = (value ?? "").trim();
  return text || "unknown";
}

function formatErrorMessage(candidate: unknown): string {
  if (candidate instanceof Error && candidate.message) return candidate.message;
  return "Cesium 初始化失败，请检查依赖与静态资源是否已同步。";
}

function hasValidGeo(tower: LineTowerSummary): boolean {
  if (tower.longitude === null || tower.latitude === null) return false;
  if (Number.isNaN(tower.longitude) || Number.isNaN(tower.latitude)) return false;
  if (tower.longitude < -180 || tower.longitude > 180) return false;
  if (tower.latitude < -90 || tower.latitude > 90) return false;
  return true;
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function calcGeoDistanceKm(start: TowerGeoPoint, end: TowerGeoPoint): number {
  const lat1 = toRad(start.latitude);
  const lat2 = toRad(end.latitude);
  const dLat = lat2 - lat1;
  const dLon = toRad(end.longitude - start.longitude);
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);
  const a = sinHalfLat * sinHalfLat
    + Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const EARTH_RADIUS_KM = 6371;
  return EARTH_RADIUS_KM * c;
}

function buildRouteSegments(points: TowerGeoPoint[]): RouteSegment[] {
  if (points.length === 0) {
    return [];
  }

  const segments: RouteSegment[] = [];
  let current: TowerGeoPoint[] = [];

  points.forEach((point, index) => {
    if (current.length === 0) {
      current.push(point);
      return;
    }

    const prev = current[current.length - 1];
    if (point.seqNo === prev.seqNo + 1) {
      current.push(point);
      return;
    }

    segments.push({
      key: `${current[0].id}-${index}`,
      points: current,
    });
    current = [point];
  });

  if (current.length > 0) {
    segments.push({
      key: `${current[0].id}-tail`,
      points: current,
    });
  }

  return segments;
}

function estimateRouteLengthKm(segments: RouteSegment[]): number {
  return segments.reduce((total, segment) => {
    if (segment.points.length < 2) {
      return total;
    }
    let length = 0;
    for (let index = 1; index < segment.points.length; index += 1) {
      length += calcGeoDistanceKm(segment.points[index - 1], segment.points[index]);
    }
    return total + length;
  }, 0);
}

export function PowerLineCesiumMap({
  lineCode,
  lineName,
  towers,
  loading = false,
  height = DEFAULT_MAP_HEIGHT,
}: PowerLineCesiumMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<import("cesium").Viewer | null>(null);
  const cesiumRef = useRef<CesiumNamespace | null>(null);
  const routeViewRef = useRef<RouteViewState | null>(null);
  const [initError, setInitError] = useState("");
  const [ready, setReady] = useState(false);
  const [colorByRisk, setColorByRisk] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  const sortedTowers = useMemo(
    () => [...towers].sort((a, b) => a.seq_no - b.seq_no),
    [towers],
  );

  const towerGeoPoints = useMemo<TowerGeoPoint[]>(() => {
    return sortedTowers
      .filter(hasValidGeo)
      .map((tower) => ({
        id: tower.id,
        seqNo: tower.seq_no,
        towerNo: tower.tower_no,
        longitude: tower.longitude ?? 0,
        latitude: tower.latitude ?? 0,
        altitudeM: tower.altitude_m ?? DEFAULT_ALTITUDE_M,
        riskLevel: tower.risk_level,
      }));
  }, [sortedTowers]);

  const routeSegments = useMemo(
    () => buildRouteSegments(towerGeoPoints),
    [towerGeoPoints],
  );
  const routeGapCount = Math.max(routeSegments.length - 1, 0);
  const routeLengthKm = useMemo(
    () => estimateRouteLengthKm(routeSegments),
    [routeSegments],
  );
  const invalidGeoCount = Math.max(sortedTowers.length - towerGeoPoints.length, 0);
  const controlsDisabled = !ready || towerGeoPoints.length === 0;

  const focusRoute = useCallback(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    const routeView = routeViewRef.current;
    if (!viewer || !Cesium || !routeView) {
      return;
    }
    viewer.camera.flyToBoundingSphere(routeView.boundingSphere, {
      duration: 0.75,
      offset: new Cesium.HeadingPitchRange(0, -0.65, routeView.range),
    });
  }, []);

  const resolveZoomDistance = useCallback((): number => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return MIN_ZOOM_STEP_RANGE;
    }
    const cameraHeight = viewer.camera.positionCartographic?.height;
    if (Number.isFinite(cameraHeight)) {
      return Math.max(Number(cameraHeight) * 0.25, MIN_ZOOM_STEP_RANGE);
    }
    const routeRange = routeViewRef.current?.range ?? MIN_CAMERA_RANGE;
    return Math.max(routeRange * 0.2, MIN_ZOOM_STEP_RANGE);
  }, []);

  const zoomInRoute = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }
    viewer.camera.zoomIn(resolveZoomDistance());
  }, [resolveZoomDistance]);

  const zoomOutRoute = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }
    viewer.camera.zoomOut(resolveZoomDistance());
  }, [resolveZoomDistance]);

  useEffect(() => {
    let cancelled = false;

    async function initViewer() {
      if (viewerRef.current || !containerRef.current) {
        return;
      }

      try {
        window.CESIUM_BASE_URL = "/cesium";
        const Cesium = await import("cesium");
        if (cancelled || !containerRef.current) {
          return;
        }

        cesiumRef.current = Cesium;
        const viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          baseLayer: false,
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
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
        viewer.scene.screenSpaceCameraController.enableZoom = true;
        const creditContainer = viewer.cesiumWidget.creditContainer as HTMLElement | null;
        if (creditContainer) {
          creditContainer.style.display = "none";
        }

        viewerRef.current = viewer;
        setInitError("");
        setReady(true);
      } catch (error) {
        if (!cancelled) {
          if (reloadOnceOnChunkError(error)) {
            return;
          }
          setInitError(formatErrorMessage(error));
          setReady(false);
        }
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
      routeViewRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!ready || !viewer || !Cesium) {
      return;
    }

    viewer.entities.removeAll();
    routeViewRef.current = null;
    if (towerGeoPoints.length === 0) {
      return;
    }

    const allPositions: import("cesium").Cartesian3[] = [];
    routeSegments.forEach((segment) => {
      if (segment.points.length < 2) {
        return;
      }
      const positions = segment.points.map((tower) => (
        Cesium.Cartesian3.fromDegrees(tower.longitude, tower.latitude, tower.altitudeM)
      ));
      allPositions.push(...positions);
      viewer.entities.add({
        id: `line-polyline-${segment.key}`,
        polyline: {
          positions,
          width: 4,
          material: Cesium.Color.fromCssColorString("#f97316"),
        },
      });
    });

    if (allPositions.length === 0) {
      allPositions.push(
        ...towerGeoPoints.map((tower) => (
          Cesium.Cartesian3.fromDegrees(tower.longitude, tower.latitude, tower.altitudeM)
        )),
      );
    }

    const shouldShowAllLabels = towerGeoPoints.length <= 40;
    const lastIndex = towerGeoPoints.length - 1;

    towerGeoPoints.forEach((tower, index) => {
      const risk = normalizeRiskLevel(tower.riskLevel);
      const color = colorByRisk ? (RISK_COLOR_BY_LEVEL[risk] ?? DEFAULT_POINT_COLOR) : DEFAULT_POINT_COLOR;
      const isEdgePoint = index === 0 || index === lastIndex;
      const shouldRenderLabel = showLabels && (shouldShowAllLabels || isEdgePoint);
      const labelPrefix = index === 0 ? "起点" : index === lastIndex ? "终点" : "";

      viewer.entities.add({
        id: `tower-${tower.id}`,
        position: Cesium.Cartesian3.fromDegrees(tower.longitude, tower.latitude, tower.altitudeM),
        point: {
          pixelSize: isEdgePoint ? 11 : 8,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: isEdgePoint ? 2 : 1.5,
        },
        label: shouldRenderLabel
          ? {
            text: labelPrefix ? `${labelPrefix} ${tower.towerNo}` : tower.towerNo,
            font: "13px sans-serif",
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }
          : undefined,
        description: `
          <div style="line-height:1.7;">
            <div><strong>塔号：</strong>${tower.towerNo}</div>
            <div><strong>序号：</strong>${tower.seqNo}</div>
            <div><strong>坐标：</strong>${tower.longitude.toFixed(6)}, ${tower.latitude.toFixed(6)}</div>
            <div><strong>海拔：</strong>${tower.altitudeM.toFixed(2)} m</div>
            <div><strong>风险等级：</strong>${tower.riskLevel ?? "-"}</div>
          </div>
        `,
      });
    });

    const boundingSphere = Cesium.BoundingSphere.fromPoints(allPositions);
    const range = Math.max(boundingSphere.radius * 2.4, MIN_CAMERA_RANGE);
    routeViewRef.current = {
      boundingSphere,
      range,
    };
    focusRoute();
  }, [ready, towerGeoPoints, routeSegments, colorByRisk, showLabels, focusRoute]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Checkbox checked={colorByRisk} onChange={(event) => setColorByRisk(event.target.checked)}>
          按风险着色
        </Checkbox>
        <Checkbox checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)}>
          显示塔号
        </Checkbox>
      </div>
      <Typography.Text type="secondary">
        线路走向图：{lineName || "-"}（{lineCode || "-"}），有效坐标 {towerGeoPoints.length}/{sortedTowers.length}，缺失 {invalidGeoCount}，
        估算长度 {routeLengthKm.toFixed(2)} km，断点段 {routeGapCount}。
      </Typography.Text>
      {initError ? <Alert type="error" showIcon message="走向图加载失败" description={initError} /> : null}

      <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-900/90" style={{ height }}>
        <div ref={containerRef} className="h-full w-full" />
        <div className="absolute right-3 top-3 z-10 flex flex-col gap-2 rounded-md border border-slate-700/80 bg-slate-950/70 p-1.5 shadow-lg backdrop-blur-sm">
          <Button
            size="small"
            shape="circle"
            icon={<PlusOutlined />}
            aria-label="放大"
            title="放大"
            onClick={zoomInRoute}
            disabled={controlsDisabled}
          />
          <Button
            size="small"
            shape="circle"
            icon={<MinusOutlined />}
            aria-label="缩小"
            title="缩小"
            onClick={zoomOutRoute}
            disabled={controlsDisabled}
          />
          <Button
            size="small"
            shape="circle"
            icon={<AimOutlined />}
            aria-label="居中重置"
            title="居中重置"
            onClick={focusRoute}
            disabled={controlsDisabled}
          />
        </div>
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-slate-950/75 px-2 py-1 text-xs text-slate-200">
          线路走向专题视图
        </div>
        {(loading || !ready) && !initError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/25">
            <Spin size="large" />
          </div>
        ) : null}
      </div>

      {towerGeoPoints.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="当前筛选条件下没有可用经纬度数据，无法绘制线路走向。"
        />
      ) : null}
    </div>
  );
}
