"use client";

import Link from "next/link";
import dayjs, { Dayjs } from "dayjs";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import { useAuth } from "@/components/auth-provider";
import { readApiError } from "@/lib/api";
import type {
  DiaryListResponse,
  DiaryMood,
  DiarySummary,
} from "@/types/auth";

type SearchParams = {
  title: string;
  mood: DiaryMood | "";
  archived: boolean | null;
  diary_date_start: string | null;
  diary_date_end: string | null;
};

type SearchFormValues = {
  title?: string;
  mood?: DiaryMood;
  archived?: "all" | "active" | "archived";
  diary_date_range?: [Dayjs, Dayjs] | null;
};

type DiaryFormValues = {
  title: string;
  content: string;
  diary_date: Dayjs;
  mood: DiaryMood;
  weather?: string;
};

type PaginationState = {
  current: number;
  pageSize: number;
  total: number;
};

const DEFAULT_SEARCH: SearchParams = {
  title: "",
  mood: "",
  archived: null,
  diary_date_start: null,
  diary_date_end: null,
};

const DEFAULT_PAGINATION: PaginationState = {
  current: 1,
  pageSize: 20,
  total: 0,
};

const MOOD_OPTIONS: Array<{ label: string; value: DiaryMood }> = [
  { label: "开心", value: "HAPPY" },
  { label: "平静", value: "CALM" },
  { label: "难过", value: "SAD" },
  { label: "生气", value: "ANGRY" },
  { label: "疲惫", value: "TIRED" },
  { label: "兴奋", value: "EXCITED" },
];

const MOOD_TAG_MAP: Record<DiaryMood, { color: string; text: string }> = {
  HAPPY: { color: "green", text: "开心" },
  CALM: { color: "blue", text: "平静" },
  SAD: { color: "purple", text: "难过" },
  ANGRY: { color: "red", text: "生气" },
  TIRED: { color: "default", text: "疲惫" },
  EXCITED: { color: "orange", text: "兴奋" },
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export default function AdminDiaryPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const [searchForm] = Form.useForm<SearchFormValues>();
  const [addForm] = Form.useForm<DiaryFormValues>();
  const [editForm] = Form.useForm<DiaryFormValues>();

  const [searchParams, setSearchParams] = useState<SearchParams>(DEFAULT_SEARCH);
  const [pagination, setPagination] = useState<PaginationState>(DEFAULT_PAGINATION);

  const [tableData, setTableData] = useState<DiarySummary[]>([]);
  const [tableLoading, setTableLoading] = useState(false);

  const [addVisible, setAddVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const [currentRecord, setCurrentRecord] = useState<DiarySummary | null>(null);
  const [panelError, setPanelError] = useState("");

  const canRead = hasPermission("menu.read") || hasPermission("menu.manage");
  const canManage = hasPermission("menu.manage");

  const fetchTableData = useCallback(
    async (params: SearchParams, pageSize: number, current: number) => {
      setTableLoading(true);
      try {
        const response = await fetchWithAuth("/api/v1/diary/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: params.title || null,
            mood: params.mood || null,
            diary_date_start: params.diary_date_start,
            diary_date_end: params.diary_date_end,
            archived: params.archived,
            page_num: Math.max(0, current - 1),
            page_size: pageSize,
          }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const payload = (await response.json()) as DiaryListResponse;
        setTableData(payload.items ?? []);
        setPagination((prev) => ({
          ...prev,
          current,
          pageSize,
          total: payload.total ?? 0,
        }));
        setPanelError("");
      } catch (error) {
        const text = error instanceof Error ? error.message : "获取日记列表失败";
        setPanelError(text);
      } finally {
        setTableLoading(false);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    if (!user || !canRead) return;
    void fetchTableData(searchParams, pagination.pageSize, pagination.current);
  }, [canRead, fetchTableData, pagination.current, pagination.pageSize, searchParams, user]);

  const handleSearch = (values: SearchFormValues) => {
    const range = values.diary_date_range;
    let archived: boolean | null = null;
    if (values.archived === "active") archived = false;
    if (values.archived === "archived") archived = true;

    const nextParams: SearchParams = {
      title: (values.title ?? "").trim(),
      mood: values.mood ?? "",
      archived,
      diary_date_start: range?.[0] ? range[0].format("YYYY-MM-DD") : null,
      diary_date_end: range?.[1] ? range[1].format("YYYY-MM-DD") : null,
    };

    setSearchParams(nextParams);
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleReset = () => {
    searchForm.resetFields();
    setSearchParams(DEFAULT_SEARCH);
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handlePaginationChange = (current: number, pageSize: number) => {
    setPagination((prev) => ({ ...prev, current, pageSize }));
  };

  const openAddModal = () => {
    addForm.resetFields();
    addForm.setFieldsValue({
      diary_date: dayjs(),
      mood: "CALM",
    });
    setAddVisible(true);
  };

  const openEditModal = (record: DiarySummary) => {
    setCurrentRecord(record);
    editForm.setFieldsValue({
      title: record.title,
      content: record.content,
      diary_date: dayjs(record.diary_date),
      mood: record.mood,
      weather: record.weather ?? undefined,
    });
    setEditVisible(true);
  };

  const openDetailModal = (record: DiarySummary) => {
    setCurrentRecord(record);
    setDetailVisible(true);
  };

  const handleAddConfirm = async () => {
    try {
      const values = await addForm.validateFields();
      setSaving(true);

      const response = await fetchWithAuth("/api/v1/diary/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          content: values.content,
          diary_date: values.diary_date.format("YYYY-MM-DD"),
          mood: values.mood,
          weather: values.weather ?? null,
          archived: false,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      message.success("日记创建成功");
      setAddVisible(false);
      addForm.resetFields();
      await fetchTableData(searchParams, pagination.pageSize, pagination.current);
    } catch (error) {
      if (error instanceof Error && error.message.includes("out of date")) return;
      const text = error instanceof Error ? error.message : "日记创建失败";
      message.error(text);
      setPanelError(text);
    } finally {
      setSaving(false);
    }
  };

  const handleEditConfirm = async () => {
    if (!currentRecord) return;
    try {
      const values = await editForm.validateFields();
      setSaving(true);

      const response = await fetchWithAuth("/api/v1/diary/update", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: currentRecord.id,
          title: values.title,
          content: values.content,
          diary_date: values.diary_date.format("YYYY-MM-DD"),
          mood: values.mood,
          weather: values.weather ?? null,
          archived: currentRecord.archived,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      message.success("日记更新成功");
      setEditVisible(false);
      setCurrentRecord(null);
      await fetchTableData(searchParams, pagination.pageSize, pagination.current);
    } catch (error) {
      if (error instanceof Error && error.message.includes("out of date")) return;
      const text = error instanceof Error ? error.message : "日记更新失败";
      message.error(text);
      setPanelError(text);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: DiarySummary) => {
    try {
      const response = await fetchWithAuth(`/api/v1/diary/delete/${record.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("日记删除成功");
      await fetchTableData(searchParams, pagination.pageSize, pagination.current);
    } catch (error) {
      const text = error instanceof Error ? error.message : "日记删除失败";
      message.error(text);
      setPanelError(text);
    }
  };

  const handleArchiveToggle = async (record: DiarySummary) => {
    try {
      const response = await fetchWithAuth(`/api/v1/diary/${record.id}/archive?archived=${String(!record.archived)}`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success(record.archived ? "已取消归档" : "已归档");
      await fetchTableData(searchParams, pagination.pageSize, pagination.current);
    } catch (error) {
      const text = error instanceof Error ? error.message : "归档操作失败";
      message.error(text);
      setPanelError(text);
    }
  };

  const columns: ColumnsType<DiarySummary> = [
    {
      title: "日期",
      dataIndex: "diary_date",
      width: 140,
      render: (value: string) => formatDate(value),
    },
    {
      title: "标题",
      dataIndex: "title",
      ellipsis: true,
      render: (_: string, record) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => openDetailModal(record)}>
          {record.title}
        </Button>
      ),
    },
    {
      title: "心情",
      dataIndex: "mood",
      width: 110,
      align: "center",
      render: (mood: DiaryMood) => {
        const mapped = MOOD_TAG_MAP[mood];
        return <Tag color={mapped.color}>{mapped.text}</Tag>;
      },
    },
    {
      title: "天气",
      dataIndex: "weather",
      width: 120,
      render: (value: string | null) => value || "-",
    },
    {
      title: "状态",
      dataIndex: "archived",
      width: 110,
      align: "center",
      render: (archived: boolean) => (
        <Tag color={archived ? "default" : "success"}>{archived ? "已归档" : "使用中"}</Tag>
      ),
    },
    {
      title: "更新时间",
      dataIndex: "update_date",
      width: 180,
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: "操作",
      width: 220,
      align: "center",
      render: (_, record) => (
        <Space size={12}>
          <Tooltip title="编辑">
            <Button type="link" size="small" onClick={() => openEditModal(record)} disabled={!canManage}>
              编辑
            </Button>
          </Tooltip>

          <Popconfirm
            title={record.archived ? "确认取消归档吗？" : "确认归档这篇日记吗？"}
            onConfirm={() => void handleArchiveToggle(record)}
          >
            <Tooltip title={record.archived ? "取消归档" : "归档"}>
              <Button type="link" size="small" disabled={!canManage}>
                {record.archived ? "取消归档" : "归档"}
              </Button>
            </Tooltip>
          </Popconfirm>

          <Popconfirm title="确认删除这篇日记吗？" onConfirm={() => void handleDelete(record)}>
            <Tooltip title="删除">
              <Button type="link" size="small" danger disabled={!canManage}>
                删除
              </Button>
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (initializing) {
    return <p className="text-sm text-[var(--gray-11)]">Loading diaries...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问日记管理页面。</p>
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
    return <p className="text-sm text-[var(--gray-11)]">缺少 `menu.read` 或 `menu.manage` 权限。</p>;
  }

  return (
    <main className="flex flex-col gap-4">
      <section className="rounded-xl border border-[var(--gray-6)] bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[var(--gray-12)]">日记管理</h1>
            <p className="text-sm text-[var(--gray-11)]">按老工程逻辑管理日记：查询、新增、编辑、归档与详情查看。</p>
          </div>
          <Space>
            <Button type="primary" onClick={openAddModal} disabled={!canManage}>
              新增日记
            </Button>
            <Tag color="blue">总数 {pagination.total}</Tag>
          </Space>
        </div>

        <Form<SearchFormValues>
          form={searchForm}
          layout="inline"
          initialValues={{ archived: "all" }}
          onFinish={handleSearch}
        >
          <Form.Item name="title" label="标题">
            <Input allowClear placeholder="请输入标题关键字" style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="mood" label="心情">
            <Select
              allowClear
              placeholder="请选择心情"
              style={{ width: 140 }}
              options={MOOD_OPTIONS}
            />
          </Form.Item>
          <Form.Item name="diary_date_range" label="日期范围">
            <DatePicker.RangePicker />
          </Form.Item>
          <Form.Item name="archived" label="状态">
            <Select
              style={{ width: 130 }}
              options={[
                { label: "全部", value: "all" },
                { label: "使用中", value: "active" },
                { label: "已归档", value: "archived" },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button htmlType="submit" type="primary">
                查询
              </Button>
              <Button onClick={handleReset}>重置</Button>
            </Space>
          </Form.Item>
        </Form>
      </section>

      {panelError ? (
        <section className="rounded-xl border border-[var(--red-6)] bg-[var(--red-2)] p-3 text-sm text-[var(--red-11)]">
          {panelError}
        </section>
      ) : null}

      <section className="rounded-xl border border-[var(--gray-6)] bg-white p-4 shadow-sm">
        <Table<DiarySummary>
          rowKey="id"
          loading={tableLoading}
          dataSource={tableData}
          columns={columns}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            onChange: handlePaginationChange,
          }}
        />
      </section>

      <Modal
        title="新增日记"
        open={addVisible}
        onCancel={() => setAddVisible(false)}
        onOk={() => void handleAddConfirm()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form<DiaryFormValues> form={addForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}> 
            <Input maxLength={256} placeholder="今天发生了什么？" />
          </Form.Item>
          <Form.Item name="content" label="正文" rules={[{ required: true, message: "请输入正文" }]}> 
            <Input.TextArea rows={6} maxLength={200000} placeholder="记录今天的想法和经历" />
          </Form.Item>
          <Form.Item name="diary_date" label="日期" rules={[{ required: true, message: "请选择日期" }]}> 
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="mood" label="心情" rules={[{ required: true, message: "请选择心情" }]}> 
            <Select options={MOOD_OPTIONS} placeholder="请选择心情" />
          </Form.Item>
          <Form.Item name="weather" label="天气"> 
            <Input maxLength={64} placeholder="例如：晴 / 多云 / 小雨" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑日记"
        open={editVisible}
        onCancel={() => {
          setEditVisible(false);
          setCurrentRecord(null);
        }}
        onOk={() => void handleEditConfirm()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form<DiaryFormValues> form={editForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}> 
            <Input maxLength={256} placeholder="今天发生了什么？" />
          </Form.Item>
          <Form.Item name="content" label="正文" rules={[{ required: true, message: "请输入正文" }]}> 
            <Input.TextArea rows={6} maxLength={200000} placeholder="记录今天的想法和经历" />
          </Form.Item>
          <Form.Item name="diary_date" label="日期" rules={[{ required: true, message: "请选择日期" }]}> 
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="mood" label="心情" rules={[{ required: true, message: "请选择心情" }]}> 
            <Select options={MOOD_OPTIONS} placeholder="请选择心情" />
          </Form.Item>
          <Form.Item name="weather" label="天气"> 
            <Input maxLength={64} placeholder="例如：晴 / 多云 / 小雨" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={currentRecord?.title ? `日记详情 - ${currentRecord.title}` : "日记详情"}
        open={detailVisible}
        footer={null}
        onCancel={() => {
          setDetailVisible(false);
          setCurrentRecord(null);
        }}
      >
        {currentRecord && (
          <div className="space-y-3">
            <Space wrap>
              <Tag>{formatDate(currentRecord.diary_date)}</Tag>
              <Tag color={MOOD_TAG_MAP[currentRecord.mood].color}>{MOOD_TAG_MAP[currentRecord.mood].text}</Tag>
              <Tag color={currentRecord.archived ? "default" : "success"}>
                {currentRecord.archived ? "已归档" : "使用中"}
              </Tag>
            </Space>

            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="天气">{currentRecord.weather || "-"}</Descriptions.Item>
              <Descriptions.Item label="创建人">{currentRecord.create_user || "-"}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{formatDateTime(currentRecord.update_date)}</Descriptions.Item>
            </Descriptions>

            <div className="rounded-md border border-[var(--gray-6)] bg-[var(--gray-1)] p-3 whitespace-pre-wrap leading-7">
              {currentRecord.content}
            </div>
          </div>
        )}
      </Modal>
    </main>
  );
}
