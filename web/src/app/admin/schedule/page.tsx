"use client";

import dayjs, { Dayjs } from "dayjs";
import {
  type ChangeEvent,
  type FC,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CheckCircleOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { readApiError } from "@/lib/api";

const { TextArea } = Input;
const { Text } = Typography;

type ViewType = "month" | "week" | "year";
type ScheduleStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "EXPIRED";
type SchedulePriority = "LOW" | "MEDIUM" | "HIGH";

type ScheduleItem = {
  id: string;
  title: string;
  descr: string;
  start_time: string;
  end_time: string;
  expire_time: string | null;
  all_day: boolean;
  status: ScheduleStatus;
  priority: SchedulePriority;
  completed_at: string | null;
  todo_id: string | null;
};

type CalendarEventPageResponse = {
  items: ScheduleItem[];
  total: number;
  page_num: number;
  page_size: number;
};

type ScheduleFormValues = {
  title: string;
  descr?: string;
  start_time?: Dayjs;
  end_time?: Dayjs;
  expire_time?: Dayjs | null;
  status?: ScheduleStatus;
  priority?: SchedulePriority;
  all_day?: boolean;
};

const priorityOptions: Array<{ label: string; value: SchedulePriority }> = [
  { label: "高", value: "HIGH" },
  { label: "中", value: "MEDIUM" },
  { label: "低", value: "LOW" },
];

const priorityColorMap: Record<SchedulePriority, string> = {
  HIGH: "red",
  MEDIUM: "orange",
  LOW: "green",
};

const statusLabelMap: Record<ScheduleStatus, string> = {
  SCHEDULED: "计划",
  IN_PROGRESS: "处理中",
  COMPLETED: "完成",
  CANCELLED: "取消",
  EXPIRED: "已过期",
};

const STATUS_OPTIONS: Array<{ label: string; value: ScheduleStatus }> = [
  { label: "已计划", value: "SCHEDULED" },
  { label: "处理中", value: "IN_PROGRESS" },
  { label: "已完成", value: "COMPLETED" },
  { label: "已取消", value: "CANCELLED" },
  { label: "已过期", value: "EXPIRED" },
];

const statusBadgeColorMap: Record<ScheduleStatus, string> = {
  SCHEDULED: "blue",
  IN_PROGRESS: "processing",
  COMPLETED: "success",
  CANCELLED: "error",
  EXPIRED: "warning",
};

function toLocalDateTimeString(value: Dayjs | null | undefined): string | null {
  if (!value) return null;
  return value.format("YYYY-MM-DDTHH:mm:ss");
}

function toScheduleItem(event: ScheduleItem): ScheduleItem {
  return {
    ...event,
    descr: event.descr ?? "",
    all_day: Boolean(event.all_day),
    expire_time: event.expire_time ?? null,
    completed_at: event.completed_at ?? null,
    todo_id: event.todo_id ?? null,
  };
}

export default function SchedulePage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [form] = Form.useForm<ScheduleFormValues>();

  const canRead = hasPermission("todo.read");
  const canCreate = hasPermission("todo.create") || hasPermission("todo.manage");
  const canProcess = hasPermission("todo.process") || hasPermission("todo.manage");
  const canManage = hasPermission("todo.manage");

  const [currentDate, setCurrentDate] = useState<Dayjs>(dayjs());
  const [viewType, setViewType] = useState<ViewType>("month");
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [panelError, setPanelError] = useState("");

  const [modalVisible, setModalVisible] = useState(false);
  const [currentSchedule, setCurrentSchedule] = useState<ScheduleItem | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  const [completeModalVisible, setCompleteModalVisible] = useState(false);
  const [completingSchedule, setCompletingSchedule] = useState<ScheduleItem | null>(null);

  const [showGeneratePanel, setShowGeneratePanel] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [generateDescription, setGenerateDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [generatedEventData, setGeneratedEventData] = useState<Partial<ScheduleItem> | null>(null);

  const streamAbortRef = useRef<AbortController | null>(null);

  const dateRange = useMemo(() => {
    switch (viewType) {
      case "week":
        return {
          start: currentDate.startOf("week"),
          end: currentDate.endOf("week"),
        };
      case "year":
        return {
          start: currentDate.startOf("year"),
          end: currentDate.endOf("year"),
        };
      case "month":
      default:
        return {
          start: currentDate.startOf("month"),
          end: currentDate.endOf("month"),
        };
    }
  }, [currentDate, viewType]);

  const loadSchedules = useCallback(async () => {
    if (!user || !canRead) return;

    setLoading(true);
    try {
      const response = await fetchWithAuth("/api/v1/calendar/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_time_from: `${dateRange.start.format("YYYY-MM-DD")}T00:00:00`,
          start_time_to: `${dateRange.end.format("YYYY-MM-DD")}T23:59:59`,
          page_num: 0,
          page_size: 500,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as CalendarEventPageResponse;
      setPanelError("");
      setSchedules((payload.items ?? []).map(toScheduleItem));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "获取日程数据失败";
      setPanelError(messageText);
    } finally {
      setLoading(false);
    }
  }, [canRead, dateRange.end, dateRange.start, fetchWithAuth, user]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  const fillFormWithGeneratedData = useCallback(
    (eventData: Partial<ScheduleItem>) => {
      form.setFieldsValue({
        title: eventData.title ?? "",
        descr: eventData.descr ?? "",
        start_time: eventData.start_time ? dayjs(eventData.start_time) : undefined,
        end_time: eventData.end_time ? dayjs(eventData.end_time) : undefined,
        expire_time: eventData.expire_time ? dayjs(eventData.expire_time) : null,
        status: eventData.status ?? "SCHEDULED",
        priority: eventData.priority ?? "MEDIUM",
        all_day: eventData.all_day ?? false,
      });
    },
    [form],
  );

  const openModal = (schedule?: ScheduleItem) => {
    if (schedule) {
      setCurrentSchedule(schedule);
      setIsEditMode(true);
      setShowGeneratePanel(false);
      setShowEditForm(true);
      form.setFieldsValue({
        title: schedule.title,
        descr: schedule.descr,
        start_time: dayjs(schedule.start_time),
        end_time: dayjs(schedule.end_time),
        expire_time: schedule.expire_time ? dayjs(schedule.expire_time) : null,
        status: schedule.status,
        priority: schedule.priority,
        all_day: schedule.all_day,
      });
    } else {
      setCurrentSchedule(null);
      setIsEditMode(false);
      setShowGeneratePanel(true);
      setShowEditForm(false);
      setGenerateDescription("");
      setGeneratedEventData(null);
      setStreamingContent("");
      form.resetFields();
      form.setFieldsValue({
        status: "SCHEDULED",
        priority: "MEDIUM",
        all_day: false,
      });
    }
    setModalVisible(true);
  };

  const cancelGenerating = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setIsGenerating(false);
  }, []);

  const handleStreamGenerateEvent = async () => {
    if (!generateDescription.trim()) {
      message.error("请输入日程描述");
      return;
    }

    cancelGenerating();
    setIsGenerating(true);
    setStreamingContent("");
    setGeneratedEventData(null);
    setShowGeneratePanel(true);
    setShowEditForm(false);

    const controller = new AbortController();
    streamAbortRef.current = controller;

    try {
      const response = await fetchWithAuth(
        `/api/v1/calendar/generate/stream?descr=${encodeURIComponent(generateDescription.trim())}`,
        {
          method: "GET",
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      if (!response.body) {
        throw new Error("生成流不可用");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let inParseResult = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let splitIndex = buffer.indexOf("\n\n");
        while (splitIndex !== -1) {
          const eventChunk = buffer.slice(0, splitIndex);
          buffer = buffer.slice(splitIndex + 2);

          for (const line of eventChunk.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trimStart();
            if (!data || data === "connected") continue;

            if (data.startsWith("[ERROR]")) {
              throw new Error(data.slice("[ERROR]".length) || "生成失败");
            }

            if (data.includes("[PARSE_RESULT]")) {
              inParseResult = true;
              continue;
            }

            if (data.startsWith("[EVENT]")) {
              const jsonText = data.slice("[EVENT]".length);
              const parsed = JSON.parse(jsonText) as Partial<ScheduleItem>;
              setGeneratedEventData(parsed);
              fillFormWithGeneratedData(parsed);
              setShowGeneratePanel(false);
              setShowEditForm(true);
              setIsGenerating(false);
              message.success("日程生成成功，请确认并保存");
              cancelGenerating();
              return;
            }

            if (!inParseResult) {
              setStreamingContent((prev) => `${prev}${data}`);
            }
          }

          splitIndex = buffer.indexOf("\n\n");
        }
      }

      setIsGenerating(false);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      const messageText = error instanceof Error ? error.message : "生成失败";
      setPanelError(messageText);
      setIsGenerating(false);
      message.error(messageText);
    }
  };

  const handleDelete = () => {
    if (!currentSchedule) return;

    Modal.confirm({
      title: "确认删除",
      content: `确定要删除日程“${currentSchedule.title}”吗？`,
      okText: "确认删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const response = await fetchWithAuth(`/api/v1/calendar/delete/${currentSchedule.id}`, {
            method: "DELETE",
          });
          if (!response.ok) {
            throw new Error(await readApiError(response));
          }
          message.success("日程删除成功");
          setModalVisible(false);
          await loadSchedules();
        } catch (error) {
          const messageText = error instanceof Error ? error.message : "删除失败";
          setPanelError(messageText);
          message.error(messageText);
        }
      },
    });
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        title: values.title,
        descr: values.descr ?? "",
        status: values.status ?? "SCHEDULED",
        priority: values.priority ?? "MEDIUM",
        start_time: toLocalDateTimeString(values.start_time) ?? `${dayjs().format("YYYY-MM-DD")}T09:00:00`,
        end_time: toLocalDateTimeString(values.end_time) ?? `${dayjs().format("YYYY-MM-DD")}T10:00:00`,
        expire_time: toLocalDateTimeString(values.expire_time ?? null),
        all_day: values.all_day ?? false,
      };

      const response = await fetchWithAuth(isEditMode && currentSchedule ? "/api/v1/calendar/update" : "/api/v1/calendar/create", {
        method: isEditMode && currentSchedule ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEditMode && currentSchedule ? { ...payload, id: currentSchedule.id } : payload),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      message.success(isEditMode ? "日程更新成功" : "日程创建成功");
      setModalVisible(false);
      setGeneratedEventData(null);
      await loadSchedules();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "保存失败";
      setPanelError(messageText);
      if (!(error instanceof Error && error.message.includes("required"))) {
        message.error(messageText);
      }
    }
  };

  const openCompleteModal = (schedule: ScheduleItem) => {
    setCompletingSchedule(schedule);
    setCompleteModalVisible(true);
  };

  const handleComplete = async () => {
    if (!completingSchedule) return;
    try {
      const response = await fetchWithAuth(`/api/v1/calendar/${completingSchedule.id}/complete`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("日程已完成");
      setCompleteModalVisible(false);
      await loadSchedules();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "操作失败";
      setPanelError(messageText);
      message.error(messageText);
    }
  };

  const navigateDate = (direction: "prev" | "next") => {
    switch (viewType) {
      case "week":
        setCurrentDate((prev) => (direction === "prev" ? prev.subtract(1, "week") : prev.add(1, "week")));
        return;
      case "year":
        setCurrentDate((prev) => (direction === "prev" ? prev.subtract(1, "year") : prev.add(1, "year")));
        return;
      case "month":
      default:
        setCurrentDate((prev) => (direction === "prev" ? prev.subtract(1, "month") : prev.add(1, "month")));
    }
  };

  const formatCurrentDate = () => {
    if (viewType === "week") {
      return `${currentDate.startOf("week").format("YYYY-MM-DD")} - ${currentDate.endOf("week").format("YYYY-MM-DD")}`;
    }
    if (viewType === "year") {
      return currentDate.format("YYYY年");
    }
    return currentDate.format("YYYY年MM月");
  };

  const renderMonthView = () => {
    const year = currentDate.year();
    const month = currentDate.month();
    const firstDay = dayjs(`${year}-${month + 1}-01`);
    const firstDayOfWeek = firstDay.day();
    const daysInMonth = firstDay.daysInMonth();
    const totalDays = firstDayOfWeek + daysInMonth + (7 - ((firstDayOfWeek + daysInMonth) % 7 || 7));

    const calendarDays: ReactElement[] = [];
    for (let i = 0; i < totalDays; i += 1) {
      const currentDay = firstDay.add(i - firstDayOfWeek, "day");
      const daySchedules = schedules.filter((schedule) => dayjs(schedule.start_time).isSame(currentDay, "day"));
      const isToday = currentDay.isSame(dayjs(), "day");
      const isCurrentMonth = currentDay.month() === month;

      calendarDays.push(
        <div
          key={`month-day-${currentDay.format("YYYY-MM-DD")}`}
          style={{
            minHeight: 120,
            border: "1px solid var(--gray-6)",
            borderRadius: 8,
            padding: 8,
            background: isToday ? "var(--indigo-2)" : "var(--gray-1)",
            opacity: isCurrentMonth ? 1 : 0.55,
            cursor: isCurrentMonth ? "pointer" : "default",
          }}
          onClick={() => {
            if (isCurrentMonth) {
              setCurrentDate(currentDay);
              setViewType("week");
            }
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{currentDay.date()}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED"] as ScheduleStatus[]).map((status) => {
              const count = daySchedules.filter((item) => item.status === status).length;
              if (!count) return null;
              return (
                <Tag key={`${currentDay.format("YYYY-MM-DD")}-${status}`} color={statusBadgeColorMap[status]}>
                  {count}
                </Tag>
              );
            })}
          </div>
        </div>,
      );
    }

    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 8, marginBottom: 8 }}>
          {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
            <div key={day} style={{ textAlign: "center", fontWeight: 600 }}>
              {day}
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 8 }}>{calendarDays}</div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekStart = currentDate.startOf("week");

    return (
      <div style={{ display: "grid", gap: 10 }}>
        {Array.from({ length: 7 }).map((_, idx) => {
          const currentDay = weekStart.add(idx, "day");
          const daySchedules = schedules
            .filter((schedule) => dayjs(schedule.start_time).isSame(currentDay, "day"))
            .sort((a, b) => dayjs(a.start_time).valueOf() - dayjs(b.start_time).valueOf());

          return (
            <div key={`week-day-${currentDay.format("YYYY-MM-DD")}`} style={{ border: "1px solid var(--gray-6)", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <strong>{currentDay.format("YYYY年MM月DD日 dddd")}</strong>
                {currentDay.isSame(dayjs(), "day") && <Tag color="processing">今天</Tag>}
              </div>

              {daySchedules.length === 0 ? (
                <div style={{ color: "var(--gray-11)" }}>暂无日程</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {daySchedules.map((schedule) => (
                    <div
                      key={schedule.id}
                      style={{
                        border: "1px solid var(--gray-6)",
                        borderRadius: 8,
                        padding: 10,
                        background: "var(--gray-2)",
                        cursor: "pointer",
                      }}
                      onClick={() => openModal(schedule)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontWeight: 600 }}>{schedule.title}</span>
                        <Tag color={statusBadgeColorMap[schedule.status]}>{statusLabelMap[schedule.status]}</Tag>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                        <span>
                          🕐 {dayjs(schedule.start_time).format("HH:mm")} - {dayjs(schedule.end_time).format("HH:mm")}
                        </span>
                        {schedule.priority !== "MEDIUM" && (
                          <Tag color={priorityColorMap[schedule.priority]}>{priorityOptions.find((item) => item.value === schedule.priority)?.label}</Tag>
                        )}
                        {canProcess && schedule.status === "SCHEDULED" && (
                          <Button
                            size="small"
                            type="primary"
                            onClick={(event: MouseEvent<HTMLElement>) => {
                              event.stopPropagation();
                              openCompleteModal(schedule);
                            }}
                            icon={<CheckCircleOutlined />}
                          >
                            完成
                          </Button>
                        )}
                      </div>
                      {schedule.descr ? <div style={{ marginTop: 6, color: "var(--gray-11)", fontSize: 12 }}>{schedule.descr}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderYearView = () => {
    const year = currentDate.year();
    const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];

    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
        {Array.from({ length: 12 }).map((_, month) => {
          const monthCount = schedules.filter((schedule) => {
            const date = dayjs(schedule.start_time);
            return date.year() === year && date.month() === month;
          }).length;

          const completedCount = schedules.filter((schedule) => {
            const date = dayjs(schedule.start_time);
            return date.year() === year && date.month() === month && schedule.status === "COMPLETED";
          }).length;

          return (
            <div
              key={`year-month-${month}`}
              style={{
                border: "1px solid var(--gray-6)",
                borderRadius: 8,
                padding: 12,
                cursor: "pointer",
                background: "var(--gray-1)",
              }}
              onClick={() => {
                setCurrentDate(dayjs(`${year}-${month + 1}-01`));
                setViewType("month");
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{year}年{monthNames[month]}</div>
              {monthCount > 0 ? (
                <Space>
                  <Tag color="processing">{monthCount} 个日程</Tag>
                  {completedCount > 0 && <Tag color="success">已完成 {completedCount}</Tag>}
                </Space>
              ) : (
                <span style={{ color: "var(--gray-11)" }}>本月无日程</span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderCalendarView = () => {
    switch (viewType) {
      case "week":
        return renderWeekView();
      case "year":
        return renderYearView();
      case "month":
      default:
        return renderMonthView();
    }
  };

  if (initializing || loading) {
    return (
      <Card>
        <Space>
          <Spin size="small" />
          <Text type="secondary">Loading schedules...</Text>
        </Space>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Text type="secondary">请先登录后再访问日程管理页面。</Text>
          <Button type="primary" href="/">
            返回首页
          </Button>
        </Space>
      </Card>
    );
  }

  if (!canRead) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Text type="secondary">你没有访问该页面的权限（需要 `todo.read`）。</Text>
          <Button type="primary" href="/">
            返回首页
          </Button>
        </Space>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ display: "flex" }}>
      {panelError ? <Alert type="error" showIcon message="请求失败" description={<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{panelError}</pre>} /> : null}

      <Card>
        <Space direction="vertical" size={12} style={{ display: "flex" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Segmented<ViewType>
              value={viewType}
              onChange={(value) => setViewType(value)}
              options={[
                { label: "年", value: "year" },
                { label: "月", value: "month" },
                { label: "周", value: "week" },
              ]}
            />

            <Space wrap>
              <Button icon={<LeftOutlined />} onClick={() => navigateDate("prev")} />
              <Text strong>{formatCurrentDate()}</Text>
              <Button icon={<RightOutlined />} onClick={() => navigateDate("next")} />
              <Button onClick={() => setCurrentDate(dayjs())}>今天</Button>
              {canCreate ? (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
                  新增日程
                </Button>
              ) : null}
            </Space>
          </div>

          {schedules.length === 0 ? (
            <Empty description="当前时间范围暂无日程" />
          ) : (
            <div>{renderCalendarView()}</div>
          )}
        </Space>
      </Card>

      <Modal
        title={isEditMode ? "编辑日程" : "新增日程"}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => {
          setModalVisible(false);
          cancelGenerating();
          setGenerateDescription("");
          setGeneratedEventData(null);
          setStreamingContent("");
        }}
        width={isEditMode || generatedEventData ? 720 : 900}
        okText="保存"
        cancelText="取消"
        footer={(
          _origin: ReactNode,
          { OkBtn, CancelBtn }: { OkBtn: FC; CancelBtn: FC },
        ) => {
          if (isEditMode) {
            return (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Button danger onClick={handleDelete} disabled={!canManage}>
                  删除
                </Button>
                <Space>
                  <CancelBtn />
                  <OkBtn />
                </Space>
              </div>
            );
          }
          return (
            <Space>
              <CancelBtn />
              <OkBtn />
            </Space>
          );
        }}
      >
        {!isEditMode && (
          <div style={{ marginBottom: 16 }}>
            {showGeneratePanel && !generatedEventData ? (
              <div style={{ border: "1px solid var(--gray-6)", borderRadius: 8, padding: 12, background: "var(--gray-2)" }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>AI 生成日程</div>
                <TextArea
                  placeholder="请描述要生成的日程，例如：明天下午3点开会，持续2小时"
                  rows={3}
                  value={generateDescription}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setGenerateDescription(event.target.value)}
                  disabled={isGenerating}
                />
                <Space style={{ marginTop: 8 }}>
                  <Button type="primary" onClick={handleStreamGenerateEvent} loading={isGenerating} disabled={!generateDescription.trim()}>
                    {isGenerating ? "生成中..." : "生成日程"}
                  </Button>
                  {isGenerating ? (
                    <Button danger onClick={cancelGenerating}>取消生成</Button>
                  ) : (
                    <Button
                      onClick={() => {
                        setShowGeneratePanel(false);
                        setShowEditForm(true);
                      }}
                    >
                      手动输入
                    </Button>
                  )}
                </Space>
                {isGenerating ? (
                  <div style={{ marginTop: 10, maxHeight: 200, overflow: "auto", border: "1px solid var(--gray-6)", borderRadius: 8, padding: 10, background: "var(--gray-1)" }}>
                    <Spin size="small" />
                    <div style={{ marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{streamingContent || "正在连接AI服务..."}</div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {(isEditMode || showEditForm) && (
          <Form form={form} layout="vertical">
            <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
              <Input placeholder="请输入日程标题" />
            </Form.Item>
            <Form.Item name="descr" label="描述">
              <Input.TextArea placeholder="请输入日程描述" rows={3} />
            </Form.Item>

            <Form.Item name="start_time" label="开始时间" rules={[{ required: true, message: "请选择开始时间" }]}>
              <DatePicker showTime style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="end_time" label="结束时间" rules={[{ required: true, message: "请选择结束时间" }]}>
              <DatePicker showTime style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="expire_time" label="过期时间">
              <DatePicker showTime style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item name="all_day" label="全天" valuePropName="checked">
              <Switch />
            </Form.Item>

            <Form.Item name="status" label="状态" rules={[{ required: true, message: "请选择状态" }]}>
              <Select
                options={STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
              />
            </Form.Item>

            <Form.Item name="priority" label="优先级">
              <Select
                options={priorityOptions.map((item) => ({ label: item.label, value: item.value }))}
              />
            </Form.Item>

            {isEditMode && currentSchedule?.completed_at ? (
              <Form.Item label="完成时间">
                <div>{dayjs(currentSchedule.completed_at).format("YYYY-MM-DD HH:mm:ss")}</div>
              </Form.Item>
            ) : null}

            {isEditMode && currentSchedule?.expire_time ? (
              <Form.Item label="当前过期时间">
                <div>{dayjs(currentSchedule.expire_time).format("YYYY-MM-DD HH:mm:ss")}</div>
              </Form.Item>
            ) : null}
          </Form>
        )}
      </Modal>

      <Modal
        title="完成日程"
        open={completeModalVisible}
        onOk={handleComplete}
        onCancel={() => setCompleteModalVisible(false)}
        okText="确认完成"
        cancelText="取消"
      >
        <div style={{ marginBottom: 10, fontWeight: 600 }}>日程: {completingSchedule?.title}</div>
        <div style={{ color: "var(--gray-11)" }}>{completingSchedule?.descr}</div>
        <div style={{ marginTop: 12, color: "var(--gray-11)" }}>
          确认将此日程标记为已完成吗？完成时间会自动设置为当前时间。
        </div>
      </Modal>
    </Space>
  );
}
