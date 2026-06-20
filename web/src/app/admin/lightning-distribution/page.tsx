"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Col,
  Descriptions,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  type CardProps,
  type MenuProps,
} from "antd";
import { MoreOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useMemo, useRef, useState, type ComponentType, type RefAttributes, useEffect } from "react";

const AntCard = Card as unknown as ComponentType<CardProps & RefAttributes<HTMLDivElement>>;

import { useAuth } from "@/components/auth-provider";
import { AdminPageLoading } from "@/components/admin-page-loading";
import { LightningDistributionMap } from "@/components/lightning-distribution-map";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { useMobileDetection } from "@/hooks/use-mobile-detection";
import { readApiError } from "@/lib/api";
import type {
  LightningDistributionImportResponse,
  LightningDistributionScatterPoint,
  LightningDistributionStatsResponse,
  LightningPolarity,
  LightningTowerBufferStatsResponse,
} from "@/types/auth";

type ImportFormValues = {
  event_year: number | null;
  region_id: string;
  location_tag: string;
  city: string;
  notes: string;
};

type DistributionFilterValues = {
  grid_size_km: number;
  years: number | null;
};

const INITIAL_IMPORT_VALUES: ImportFormValues = {
  event_year: null,
  region_id: "",
  location_tag: "",
  city: "",
  notes: "",
};

const INITIAL_DISTRIBUTION_FILTERS: DistributionFilterValues = {
  grid_size_km: 1,
  years: null,
};

const LIGHTNING_TABLE_MIN_SCROLL_Y = 180;
const LIGHTNING_TABLE_VIEWPORT_GAP = 40;
const LIGHTNING_TABLE_FALLBACK_RESERVE = 220;

function formatNullable(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function formatNumber(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function formatPolarity(polarity: LightningPolarity): string {
  if (polarity === "positive") return "正极性";
  if (polarity === "negative") return "负极性";
  if (polarity === "mixed") return "混合";
  return "未知";
}

export default function AdminLightningDistributionPage() {
  const { user, initializing, hasPermission, fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useMobileDetection();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [importForm] = Form.useForm<ImportFormValues>();
  const [distributionForm] = Form.useForm<DistributionFilterValues>();

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [statsModalOpen, setStatsModalOpen] = useState(false);

  const [distributionFilters, setDistributionFilters] = useState<DistributionFilterValues>(INITIAL_DISTRIBUTION_FILTERS);
  const [keywordInput, setKeywordInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [selectedEventForModal, setSelectedEventForModal] = useState<LightningDistributionScatterPoint | null>(null);
  const keywordDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pageCardRef = useRef<HTMLDivElement | null>(null);
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const viewMode: "table" | "card" = isMobile ? "card" : "table";
  const [cardViewPage, setCardViewPage] = useState(1);
  const [allLoadedEvents, setAllLoadedEvents] = useState<LightningDistributionScatterPoint[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [tableScrollY, setTableScrollY] = useState(LIGHTNING_TABLE_MIN_SCROLL_Y);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });

  const canRead = hasPermission("lightning.read") || hasPermission("lightning.manage");
  const canManage = hasPermission("lightning.manage");

  const trimmedKeyword = searchKeyword.trim();
  const distributionStatsPath = useMemo(() => {
    const params = new URLSearchParams();
    if (regionFilter.trim()) params.set("region_id", regionFilter.trim());
    if (trimmedKeyword) params.set("location_tag", trimmedKeyword);
    if (distributionFilters.years !== null) params.set("years", String(distributionFilters.years));
    params.set("grid_size_km", String(distributionFilters.grid_size_km));
    params.set("grid_limit", "1000");
    params.set("scatter_limit", "2000");
    return `/api/v1/lightning-currents/stats/distribution?${params.toString()}`;
  }, [distributionFilters, trimmedKeyword, regionFilter]);

  const distributionStatsQuery = useQuery({
    queryKey: [distributionStatsPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(distributionStatsPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningDistributionStatsResponse;
    },
  });

  const distributionStats = distributionStatsQuery.data;
  const scatterPoints = useMemo(() => distributionStats?.scatter_points ?? [], [distributionStats?.scatter_points]);

  const distributionError = distributionStatsQuery.error instanceof Error ? distributionStatsQuery.error.message : "";

  useToastFeedback({
    errorMessage: error || distributionError,
    successMessage: success,
    clearError: () => setError(""),
    clearSuccess: () => setSuccess(""),
  });

  const refreshAll = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/lightning-currents"),
    });
  }, [queryClient]);

  useTopicSubscription(
    "admin.lightning-currents",
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!canManage) {
        throw new Error("缺少 lightning.manage 权限");
      }
      const values = importForm.getFieldsValue(true);
      const formData = new FormData();
      formData.append("file", file);
      if (values.event_year !== null && values.event_year !== undefined) {
        formData.append("event_year", String(values.event_year));
      }
      if (values.region_id?.trim()) formData.append("region_id", values.region_id.trim());
      if (values.location_tag?.trim()) formData.append("location_tag", values.location_tag.trim());
      if (values.city?.trim()) formData.append("city", values.city.trim());
      if (values.notes?.trim()) formData.append("notes", values.notes.trim());

      const response = await fetchWithAuth("/api/v1/lightning-currents/import-distribution", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningDistributionImportResponse;
    },

    onSuccess: async (payload) => {
      setError("");
      setSuccess(
        payload.warning_count > 0
          ? `分布导入完成：成功 ${payload.imported_count} 条，跳过 ${payload.skipped_count} 条，告警 ${payload.warning_count} 条`
          : `分布导入完成：成功 ${payload.imported_count} 条`,
      );
      setImportModalOpen(false);
      importForm.resetFields();
      await refreshAll();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "分布导入失败");
    },
  });

  const openStatsModal = (event: LightningDistributionScatterPoint) => {
    setSelectedEventForModal(event);
    setStatsModalOpen(true);
  };

  const closeImportModal = () => {
    setImportModalOpen(false);
    importForm.resetFields();
  };

  const closeStatsModal = () => {
    setStatsModalOpen(false);
    setSelectedEventForModal(null);
  };

  const handleKeywordChange = (value: string) => {
    setKeywordInput(value);

    if (keywordDebounceTimeoutRef.current) {
      clearTimeout(keywordDebounceTimeoutRef.current);
    }

    keywordDebounceTimeoutRef.current = setTimeout(() => {
      setSearchKeyword(value);
      setCardViewPage(1);
      setAllLoadedEvents([]);
    }, 500);
  };

  const updateTableScrollY = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const anchor = tableScrollAnchorRef.current;
    if (!anchor) {
      return;
    }

    const anchorTop = anchor.getBoundingClientRect().top;
    const tableWrapper = anchor.querySelector<HTMLElement>(".ant-table-wrapper");
    const tableBody = anchor.querySelector<HTMLElement>(".ant-table-body");

    let nextHeight = Math.floor(window.innerHeight - anchorTop - LIGHTNING_TABLE_FALLBACK_RESERVE);
    if (tableWrapper) {
      const wrapperRect = tableWrapper.getBoundingClientRect();
      const bodyHeight = tableBody?.getBoundingClientRect().height ?? LIGHTNING_TABLE_MIN_SCROLL_Y;
      const nonBodyHeight = Math.max(0, wrapperRect.height - bodyHeight);
      const topGap = Math.max(0, wrapperRect.top - anchorTop);
      nextHeight = Math.floor(window.innerHeight - anchorTop - topGap - nonBodyHeight - LIGHTNING_TABLE_VIEWPORT_GAP);
    }

    const clampedHeight = Math.max(LIGHTNING_TABLE_MIN_SCROLL_Y, nextHeight);
    setTableScrollY((previous) => (Math.abs(previous - clampedHeight) <= 1 ? previous : clampedHeight));
  }, []);

  useEffect(() => {
    return () => {
      if (keywordDebounceTimeoutRef.current) {
        clearTimeout(keywordDebounceTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (viewMode !== "card" || distributionStatsQuery.isLoading) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (cardViewPage === 1) {
        setAllLoadedEvents(() => scatterPoints);
      } else {
        setAllLoadedEvents((prev) => {
          if (scatterPoints.length === 0) {
            return prev;
          }
          const existingIds = new Set(prev.map(e => e.id));
          const newEvents = scatterPoints.filter(e => !existingIds.has(e.id));
          return [...prev, ...newEvents];
        });
      }
      setIsLoadingMore(false);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [scatterPoints, distributionStatsQuery.isLoading, viewMode, cardViewPage]);

  useEffect(() => {
    if (viewMode !== "card") return;

    const pageCard = pageCardRef.current;
    if (!pageCard) return;

    const cardBody = pageCard.querySelector<HTMLElement>(".ant-card-body");
    if (!cardBody) return;

    const handleScroll = () => {
      if (isLoadingMore || distributionStatsQuery.isLoading) return;

      const scrollTop = cardBody.scrollTop;
      const scrollHeight = cardBody.scrollHeight;
      const clientHeight = cardBody.clientHeight;

      if (scrollTop + clientHeight >= scrollHeight - 100) {
        const loadedCount = allLoadedEvents.length;
        const totalCount = scatterPoints.length;

        if (loadedCount < totalCount) {
          setIsLoadingMore(true);
          setCardViewPage((prev) => prev + 1);
        }
      }
    };

    cardBody.addEventListener("scroll", handleScroll);
    return () => cardBody.removeEventListener("scroll", handleScroll);
  }, [viewMode, isLoadingMore, distributionStatsQuery.isLoading, allLoadedEvents.length, scatterPoints.length]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(updateTableScrollY);
  }, [error, distributionError, scatterPoints.length, distributionStatsQuery.isFetching, updateTableScrollY]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onViewportChange = () => {
      window.requestAnimationFrame(updateTableScrollY);
    };

    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
    };
  }, [updateTableScrollY]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      return;
    }

    const anchor = tableScrollAnchorRef.current;
    if (!anchor) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(updateTableScrollY);
    });
    resizeObserver.observe(anchor);

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateTableScrollY]);

  const eventColumns = useMemo<ColumnsType<LightningDistributionScatterPoint>>(
    () => [
      {
        title: "事件编号",
        dataIndex: "event_id",
        width: 180,
        render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
      },
      {
        title: "城市",
        dataIndex: "city",
        width: 120,
        render: (value: string | null) => value || "-",
      },
      {
        title: "地点标签",
        dataIndex: "location_tag",
        width: 150,
        render: (value: string | null) => value || "-",
      },
      {
        title: "经度",
        dataIndex: "longitude",
        width: 120,
        render: (value: number) => formatNumber(value, 5),
      },
      {
        title: "纬度",
        dataIndex: "latitude",
        width: 120,
        render: (value: number) => formatNumber(value, 5),
      },

      {
        title: "电流(kA)",
        dataIndex: "current_ka",
        width: 120,
        render: (value: number | null) => formatNumber(value, 2),
      },
      {
        title: "绝对值(kA)",
        dataIndex: "abs_current_ka",
        width: 120,
        render: (value: number | null) => formatNumber(value, 2),
      },
      {
        title: "极性",
        dataIndex: "polarity",
        width: 100,
        render: (value: LightningPolarity) => formatPolarity(value),
      },
      {
        title: "事件时间",
        dataIndex: "event_time",
        width: 180,
        render: (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-",
      },
      {
        title: "操作",
        key: "actions",
        width: 150,
        fixed: "right",
        render: (_: unknown, row) => (
          <Space wrap>
            <Button size="small" onClick={() => openStatsModal(row)}>
              统计详情
            </Button>
          </Space>
        ),
      },
    ],
    [],
  );

  const renderEventCard = (event: LightningDistributionScatterPoint) => {
    return (
      <AntCard
        key={event.id}
        className="admin-lightning-distribution-event-card"
        size="small"
        title={
          <Space className="min-w-0" size={8}>
            <Typography.Text strong code>{event.event_id}</Typography.Text>
          </Space>
        }
        extra={
          <Button
            type="text"
            size="small"
            onClick={() => openStatsModal(event)}
          >
            详情
          </Button>
        }
      >
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <div className="admin-lightning-distribution-event-card-field">
            <Typography.Text type="secondary">城市</Typography.Text>
            <Typography.Text>{event.city || "-"}</Typography.Text>
          </div>
          <div className="admin-lightning-distribution-event-card-field">
            <Typography.Text type="secondary">地点标签</Typography.Text>
            <Typography.Text>{event.location_tag || "-"}</Typography.Text>
          </div>
          <div className="admin-lightning-distribution-event-card-field">
            <Typography.Text type="secondary">坐标</Typography.Text>
            <Typography.Text>
              {formatNumber(event.longitude, 5)}, {formatNumber(event.latitude, 5)}
            </Typography.Text>
          </div>
          <div className="admin-lightning-distribution-event-card-field">
            <Typography.Text type="secondary">电流/极性</Typography.Text>
            <Space size={4}>
              <Typography.Text>{formatNumber(event.current_ka, 2)} kA</Typography.Text>
              <Tag>{formatPolarity(event.polarity)}</Tag>
            </Space>
          </div>
          {event.event_time && (
            <div className="admin-lightning-distribution-event-card-field">
              <Typography.Text type="secondary">事件时间</Typography.Text>
              <Typography.Text>
                {new Date(event.event_time).toLocaleString("zh-CN", { hour12: false })}
              </Typography.Text>
            </div>
          )}
        </Space>
      </AntCard>
    );
  };

  if (initializing) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Spin tip="初始化中..." />
      </div>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问地闪密度统计页面。</p>
        <Link
          href="/"
          className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]"
        >
          返回首页
        </Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `lightning.read`）。</p>
        <Link
          href="/"
          className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]"
        >
          返回首页
        </Link>
      </main>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AntCard
        ref={pageCardRef}
        className="admin-lightning-distribution-page-card"
        title="地闪密度统计"
        extra={
          canManage && (
            <Button type="primary" onClick={() => setImportModalOpen(true)}>
              导入地闪密度数据
            </Button>
          )
        }
      >
        <Space direction="vertical" size={12} className="w-full">
          <Typography.Text type="secondary">
            基于经纬度与电流幅值展示雷电空间分布，支持按地点、区域等条件筛选。
          </Typography.Text>

          {viewMode === "card" ? (
            <Form layout="vertical" style={{ marginBottom: 16 }}>
              <Form.Item label="关键词" style={{ marginBottom: 12 }}>
                <Input
                  allowClear
                  placeholder="按地点/标签筛选"
                  value={keywordInput}
                  onChange={(event) => handleKeywordChange(event.target.value)}
                />
              </Form.Item>
              <Form.Item label="Region ID" style={{ marginBottom: 12 }}>
                <Input
                  allowClear
                  placeholder="按 Region ID 筛选"
                  value={regionFilter}
                  onChange={(event) => {
                    setRegionFilter(event.target.value);
                    setCardViewPage(1);
                    setAllLoadedEvents([]);
                  }}
                />
              </Form.Item>
              <Form.Item label="网格尺寸(km)" style={{ marginBottom: 12 }}>
                <InputNumber
                  className="w-full"
                  min={0.1}
                  max={100}
                  precision={2}
                  value={distributionFilters.grid_size_km}
                  onChange={(value) => {
                    if (value !== null) {
                      setDistributionFilters((prev) => ({ ...prev, grid_size_km: value }));
                      setCardViewPage(1);
                      setAllLoadedEvents([]);
                      setPagination((prev) => ({ ...prev, current: 1 }));
                    }
                  }}
                />
              </Form.Item>
              <Form.Item label="统计年限(可选)" style={{ marginBottom: 0 }}>
                <InputNumber
                  className="w-full"
                  min={0.01}
                  precision={2}
                  value={distributionFilters.years}
                  onChange={(value) => {
                    setDistributionFilters((prev) => ({ ...prev, years: value }));
                    setCardViewPage(1);
                    setAllLoadedEvents([]);
                    setPagination((prev) => ({ ...prev, current: 1 }));
                  }}
                />
              </Form.Item>
            </Form>
          ) : (
            <Form layout="inline" style={{ rowGap: 12 }}>
              <Form.Item label="关键词" style={{ width: 260 }}>
                <Input
                  allowClear
                  placeholder="按地点/标签筛选"
                  value={keywordInput}
                  onChange={(event) => handleKeywordChange(event.target.value)}
                />
              </Form.Item>
              <Form.Item label="Region ID" style={{ width: 200 }}>
                <Input
                  allowClear
                  placeholder="按 Region ID 筛选"
                  value={regionFilter}
                  onChange={(event) => {
                    setRegionFilter(event.target.value);
                    setCardViewPage(1);
                    setAllLoadedEvents([]);
                    setPagination((prev) => ({ ...prev, current: 1 }));
                  }}
                />
              </Form.Item>
              <Form.Item label="网格尺寸(km)" style={{ width: 160 }}>
                <InputNumber
                  className="w-full"
                  min={0.1}
                  max={100}
                  precision={2}
                  value={distributionFilters.grid_size_km}
                  onChange={(value) => {
                    if (value !== null) {
                      setDistributionFilters((prev) => ({ ...prev, grid_size_km: value }));
                      setCardViewPage(1);
                      setAllLoadedEvents([]);
                      setPagination((prev) => ({ ...prev, current: 1 }));
                    }
                  }}
                />
              </Form.Item>
              <Form.Item label="统计年限(可选)" style={{ width: 160 }}>
                <InputNumber
                  className="w-full"
                  min={0.01}
                  precision={2}
                  value={distributionFilters.years}
                  onChange={(value) => {
                    setDistributionFilters((prev) => ({ ...prev, years: value }));
                    setCardViewPage(1);
                    setAllLoadedEvents([]);
                    setPagination((prev) => ({ ...prev, current: 1 }));
                  }}
                />
              </Form.Item>
            </Form>
          )}

          {viewMode === "table" ? (
            <div ref={tableScrollAnchorRef} className="admin-lightning-distribution-table-anchor mt-4">
              <Table<LightningDistributionScatterPoint>
                rowKey="id"
                columns={eventColumns}
                dataSource={scatterPoints}
                loading={distributionStatsQuery.isFetching}
                tableLayout="fixed"
                pagination={{
                  current: pagination.current,
                  pageSize: pagination.pageSize,
                  total: scatterPoints.length,
                  showSizeChanger: true,
                  pageSizeOptions: [10, 20, 50, 100],
                  showTotal: (total) => `共 ${total} 条`,
                  hideOnSinglePage: false,
                  style: { marginBottom: 0 },
                  onChange: (page, pageSize) => {
                    setPagination({ current: page, pageSize });
                  },
                }}
                scroll={{ x: 1400, y: tableScrollY }}
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="未找到符合筛选条件的事件。"
                    />
                  ),
                }}
              />
            </div>
          ) : (
            <div className="admin-lightning-distribution-card-view">
              {distributionStatsQuery.isLoading && allLoadedEvents.length === 0 ? (
                <div className="admin-lightning-distribution-card-view-state">
                  <Spin tip="加载中..." />
                </div>
              ) : allLoadedEvents.length === 0 ? (
                <div className="admin-lightning-distribution-card-view-state">
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="未找到符合筛选条件的事件。"
                  />
                </div>
              ) : (
                <div className="admin-lightning-distribution-card-view-content">
                  <Row gutter={[12, 12]}>
                    {allLoadedEvents.map((event) => (
                      <Col key={event.id} xs={24} sm={24} md={12} lg={8} xl={6}>
                        {renderEventCard(event)}
                      </Col>
                    ))}
                  </Row>
                  {isLoadingMore && (
                    <div style={{ textAlign: "center", padding: "20px 0" }}>
                      <Spin tip="加载更多..." />
                    </div>
                  )}
                  {allLoadedEvents.length >= scatterPoints.length && allLoadedEvents.length > 0 && (
                    <div style={{ textAlign: "center", padding: "20px 0" }}>
                      <Typography.Text type="secondary">
                        已加载全部 {allLoadedEvents.length} 条数据
                      </Typography.Text>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Space>
      </AntCard>

      <Modal
        title="导入地闪密度数据"
        open={importModalOpen}
        onCancel={closeImportModal}
        footer={null}
        width={800}
        destroyOnClose
      >
        <Form<ImportFormValues> form={importForm} layout="vertical" initialValues={INITIAL_IMPORT_VALUES}>
          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item name="event_year" label="事件年份">
              <InputNumber className="w-full" min={1900} max={2100} />
            </Form.Item>
            <Form.Item name="region_id" label="区域ID">
              <Input placeholder="例如 region-001" />
            </Form.Item>
            <Form.Item name="location_tag" label="地点标签">
              <Input placeholder="例如 某变电站" />
            </Form.Item>
            <Form.Item name="city" label="城市">
              <Input placeholder="例如 上海" />
            </Form.Item>
          </div>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="可填写数据来源、采集说明等" />
          </Form.Item>
          <Space>
            <Button type="primary" onClick={() => uploadInputRef.current?.click()} loading={importMutation.isPending}>
              选择文件并导入
            </Button>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              className="hidden"

              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) {
                  try {
                    await importForm.validateFields();
                    importMutation.mutate(file);
                  } catch {
                    // 表单校验失败时不触发导入。
                  }
                }
                event.target.value = "";
              }}
            />
            <Typography.Text type="secondary">
              支持包含经纬度和电流的CSV或TXT文件。
            </Typography.Text>
          </Space>
        </Form>
      </Modal>

      <Modal
        title={selectedEventForModal ? `统计详情 - ${selectedEventForModal.event_id}` : "统计详情"}
        open={statsModalOpen}
        onCancel={closeStatsModal}
        footer={null}
        width={1200}
        destroyOnClose
      >
        {selectedEventForModal && distributionStats && (
          <Space direction="vertical" size={16} className="w-full">
            <div>
              <Typography.Title level={5}>区域统计摘要</Typography.Title>
              <Descriptions bordered size="small" column={4}>
                <Descriptions.Item label="记录总数">{distributionStats.summary.total_records}</Descriptions.Item>
                <Descriptions.Item label="统计面积(km²)">{formatNumber(distributionStats.summary.area_km2, 3)}</Descriptions.Item>
                <Descriptions.Item label="统计年限">{formatNumber(distributionStats.summary.data_years, 3)}</Descriptions.Item>
                <Descriptions.Item label="整体 Ng">{formatNumber(distributionStats.summary.overall_ng_per_km2_year, 4)}</Descriptions.Item>
                <Descriptions.Item label="Imax(kA)">{formatNumber(distributionStats.summary.max_abs_current_ka, 2)}</Descriptions.Item>
                <Descriptions.Item label="Iavg(kA)">{formatNumber(distributionStats.summary.avg_abs_current_ka, 2)}</Descriptions.Item>
                <Descriptions.Item label="正极占比">
                  {`${(distributionStats.polarity.positive_ratio * 100).toFixed(2)}%`}
                </Descriptions.Item>
                <Descriptions.Item label="负极占比">
                  {`${(distributionStats.polarity.negative_ratio * 100).toFixed(2)}%`}
                </Descriptions.Item>

                <Descriptions.Item label="实测条数">{distributionStats.sources.measured_count}</Descriptions.Item>
                <Descriptions.Item label="合成条数">{distributionStats.sources.synthetic_count}</Descriptions.Item>
                <Descriptions.Item label="网格数">{distributionStats.grid_cells.length}</Descriptions.Item>
                <Descriptions.Item label="散点数">{distributionStats.scatter_points.length}</Descriptions.Item>
              </Descriptions>
            </div>

            <div>
              <Typography.Title level={5}>空间分布地图</Typography.Title>
              <LightningDistributionMap
                points={distributionStats.scatter_points}
                grids={distributionStats.grid_cells}
                loading={distributionStatsQuery.isFetching}
              />
            </div>

            <div>
              <Typography.Title level={5}>当前事件信息</Typography.Title>
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="事件编号">{selectedEventForModal.event_id}</Descriptions.Item>
                <Descriptions.Item label="城市">{formatNullable(selectedEventForModal.city)}</Descriptions.Item>
                <Descriptions.Item label="地点标签">{formatNullable(selectedEventForModal.location_tag)}</Descriptions.Item>
                <Descriptions.Item label="区域ID">{formatNullable(selectedEventForModal.region_id)}</Descriptions.Item>
                <Descriptions.Item label="经度">{formatNumber(selectedEventForModal.longitude, 5)}</Descriptions.Item>
                <Descriptions.Item label="纬度">{formatNumber(selectedEventForModal.latitude, 5)}</Descriptions.Item>
                <Descriptions.Item label="电流(kA)">{formatNumber(selectedEventForModal.current_ka, 2)}</Descriptions.Item>
                <Descriptions.Item label="绝对值(kA)">{formatNumber(selectedEventForModal.abs_current_ka, 2)}</Descriptions.Item>
                <Descriptions.Item label="极性">{formatPolarity(selectedEventForModal.polarity)}</Descriptions.Item>
                <Descriptions.Item label="事件时间">
                  {selectedEventForModal.event_time ? new Date(selectedEventForModal.event_time).toLocaleString("zh-CN", { hour12: false }) : "-"}
                </Descriptions.Item>
              </Descriptions>
            </div>
          </Space>
        )}
      </Modal>
    </div>
  );
}

