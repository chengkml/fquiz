"use client";

import { Alert, Empty, Spin, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import { reloadOnceOnChunkError } from "@/lib/chunk-error";
import type { LineTowerSummary } from "@/types/auth";

type PowerLineCesiumMapProps = {
  lineCode?: string;
  lineName?: string;
  towers: LineTowerSummary[];
  loading?: boolean;
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

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}

const MAP_HEIGHT = 560;
const DEFAULT_ALTITUDE_M = 0;
const MIN_CAMERA_RANGE = 1500;
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

export function PowerLineCesiumMap({
  lineCode,
  lineName,
  towers,
  loading = false,
}: PowerLineCesiumMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<import("cesium").Viewer | null>(null);
  const cesiumRef = useRef<CesiumNamespace | null>(null);
  const [initError, setInitError] = useState("");
  const [ready, setReady] = useState(false);

  const towerGeoPoints = useMemo<TowerGeoPoint[]>(() => {
    return towers
      .filter(hasValidGeo)
      .sort((a, b) => a.seq_no - b.seq_no)
      .map((tower) => ({
        id: tower.id,
        seqNo: tower.seq_no,
        towerNo: tower.tower_no,
        longitude: tower.longitude ?? 0,
        latitude: tower.latitude ?? 0,
        altitudeM: tower.altitude_m ?? DEFAULT_ALTITUDE_M,
        riskLevel: tower.risk_level,
      }));
  }, [towers]);

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
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          shouldAnimate: false,
        });

        viewer.scene.globe.depthTestAgainstTerrain = false;
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
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) {
      return;
    }

    viewer.entities.removeAll();
    if (towerGeoPoints.length === 0) {
      return;
    }

    const polylinePositions = towerGeoPoints.map((tower) => (
      Cesium.Cartesian3.fromDegrees(tower.longitude, tower.latitude, tower.altitudeM)
    ));

    viewer.entities.add({
      id: "line-polyline",
      polyline: {
        positions: polylinePositions,
        width: 4,
        material: Cesium.Color.fromCssColorString("#f97316"),
      },
    });

    const shouldShowAllLabels = towerGeoPoints.length <= 30;
    const lastIndex = towerGeoPoints.length - 1;

    towerGeoPoints.forEach((tower, index) => {
      const risk = normalizeRiskLevel(tower.riskLevel);
      const color = RISK_COLOR_BY_LEVEL[risk] ?? "#2563eb";

      viewer.entities.add({
        id: `tower-${tower.id}`,
        position: Cesium.Cartesian3.fromDegrees(tower.longitude, tower.latitude, tower.altitudeM),
        point: {
          pixelSize: 9,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1.5,
        },
        label: shouldShowAllLabels || index === 0 || index === lastIndex
          ? {
            text: tower.towerNo,
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

    const boundingSphere = Cesium.BoundingSphere.fromPoints(polylinePositions);
    const range = Math.max(boundingSphere.radius * 2.4, MIN_CAMERA_RANGE);
    viewer.camera.flyToBoundingSphere(boundingSphere, {
      duration: 0.8,
      offset: new Cesium.HeadingPitchRange(0, -0.65, range),
    });
  }, [towerGeoPoints]);

  return (
    <div className="space-y-3">
      <Typography.Text type="secondary">
        地图展示线路：{lineName || "-"}（{lineCode || "-"}），当前加载 {towerGeoPoints.length} 个有效坐标点。
      </Typography.Text>
      {initError ? <Alert type="error" showIcon message="地图加载失败" description={initError} /> : null}

      <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-900/90" style={{ height: MAP_HEIGHT }}>
        <div ref={containerRef} className="h-full w-full" />
        {(loading || !ready) && !initError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/25">
            <Spin size="large" />
          </div>
        ) : null}
      </div>

      {towerGeoPoints.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="当前筛选条件下没有可用经纬度数据，无法绘制线路。"
        />
      ) : null}
    </div>
  );
}
