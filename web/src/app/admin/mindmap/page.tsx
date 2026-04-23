"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import { useAuth } from "@/components/auth-provider";
import { readApiError } from "@/lib/api";
import type { MindMapListResponse, MindMapSummary } from "@/types/auth";

type SearchValues = {
  map_name?: string;
};

type EditValues = {
  map_name: string;
  descr?: string;
};

type PaginationState = {
  current: number;
  pageSize: number;
  total: number;
};

const DEFAULT_PAGINATION: PaginationState = {
  current: 1,
  pageSize: 20,
  total: 0,
};

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export default function AdminMindMapPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const router = useRouter();

  const [searchForm] = Form.useForm<SearchValues>();
  const [createForm] = Form.useForm<EditValues>();
  const [editForm] = Form.useForm<EditValues>();

  const [loading, setLoading] = useState(false);
  const [panelError, setPanelError] = useState("");

  const [items, setItems] = useState<MindMapSummary[]>([]);
  const [pagination, setPagination] = useState<PaginationState>(DEFAULT_PAGINATION);

  const [searchKeyword, setSearchKeyword] = useState("");
  const [createVisible, setCreateVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<MindMapSummary | null>(null);

  const canRead = hasPermission("question_bank.read") || hasPermission("question_bank.manage");
  const canManage = hasPermission("question_bank.manage");

  const currentPage = pagination.current;
  const currentPageSize = pagination.pageSize;

  const fetchMindMaps = useCallback(
    async (pageNum: number, pageSize: number, mapName: string) => {
      setLoading(true);
      try {
        const response = await fetchWithAuth("/api/v1/mindmap/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            map_name: mapName || null,
            page_num: Math.max(0, pageNum - 1),
            page_size: pageSize,
          }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const payload = (await response.json()) as MindMapListResponse;
        setItems(payload.items ?? []);
        setPagination({
          current: pageNum,
          pageSize,
          total: payload.total ?? 0,
        });
        setPanelError("");
      } catch (error) {
        const text = error instanceof Error ? error.message : "加载思维导图失败";
        setPanelError(text);
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    if (!user || !canRead) return;
    void fetchMindMaps(currentPage, currentPageSize, searchKeyword);
  }, [canRead, currentPage, currentPageSize, fetchMindMaps, searchKeyword, user]);

  const handleSearch = (values: SearchValues) => {
    const keyword = (values.map_name ?? "").trim();
    setSearchKeyword(keyword);
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleReset = () => {
    searchForm.resetFields();
    setSearchKeyword("");
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handlePaginationChange = (currentValue: number, pageSizeValue: number) => {
    setPagination((prev) => ({
      ...prev,
      current: currentValue,
      pageSize: pageSizeValue,
    }));
  };

  const openCreate = () => {
    createForm.resetFields();
    setCreateVisible(true);
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setSaving(true);
      const response = await fetchWithAuth("/api/v1/mindmap/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          map_name: values.map_name,
          descr: values.descr ?? "",
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const created = (await response.json()) as MindMapSummary;
      message.success("思维导图创建成功");
      setCreateVisible(false);
      router.push(`/admin/mindmap/edit/${created.id}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("out of date")) return;
      const text = error instanceof Error ? error.message : "思维导图创建失败";
      message.error(text);
      setPanelError(text);
    } finally {
      setSaving(false);
    }
  };

  const openEditBasicInfo = (record: MindMapSummary) => {
    setCurrent(record);
    editForm.setFieldsValue({
      map_name: record.map_name,
      descr: record.descr ?? "",
    });
    setEditVisible(true);
  };

  const handleEditBasicInfo = async () => {
    if (!current) return;
    try {
      const values = await editForm.validateFields();
      setSaving(true);
      const response = await fetchWithAuth("/api/v1/mindmap/update-basic-info", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          map_name: values.map_name,
          descr: values.descr ?? "",
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("思维导图信息已更新");
      setEditVisible(false);
      setCurrent(null);
      await fetchMindMaps(pagination.current, pagination.pageSize, searchKeyword);
    } catch (error) {
      if (error instanceof Error && error.message.includes("out of date")) return;
      const text = error instanceof Error ? error.message : "更新思维导图失败";
      message.error(text);
      setPanelError(text);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: MindMapSummary) => {
    try {
      const response = await fetchWithAuth(`/api/v1/mindmap/delete/${record.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("思维导图删除成功");
      await fetchMindMaps(pagination.current, pagination.pageSize, searchKeyword);
    } catch (error) {
      const text = error instanceof Error ? error.message : "删除思维导图失败";
      message.error(text);
      setPanelError(text);
    }
  };

  const columns = useMemo<ColumnsType<MindMapSummary>>(
    () => [
      {
        title: "导图名称",
        dataIndex: "map_name",
        ellipsis: true,
        render: (_, record) => (
          <Button type="link" style={{ padding: 0 }} onClick={() => router.push(`/admin/mindmap/edit/${record.id}`)}>
            {record.map_name}
          </Button>
        ),
      },
      {
        title: "描述",
        dataIndex: "descr",
        ellipsis: true,
        render: (value: string | null) => value || "-",
      },
      {
        title: "创建人",
        dataIndex: "create_user",
        width: 140,
        align: "center",
        render: (value: string | null) => value || "-",
      },
      {
        title: "创建时间",
        dataIndex: "create_date",
        width: 190,
        render: (value: string | null) => formatDateTime(value),
      },
      {
        title: "操作",
        width: 240,
        align: "center",
        render: (_, record) => (
          <Space size={12}>
            <Tooltip title="绘图">
              <Button type="link" size="small" onClick={() => router.push(`/admin/mindmap/edit/${record.id}`)}>
                绘图
              </Button>
            </Tooltip>
            <Tooltip title="编辑信息">
              <Button type="link" size="small" onClick={() => openEditBasicInfo(record)} disabled={!canManage}>
                编辑
              </Button>
            </Tooltip>
            <Popconfirm title="确认删除该思维导图吗？" onConfirm={() => void handleDelete(record)}>
              <Tooltip title="删除">
                <Button type="link" size="small" danger disabled={!canManage}>
                  删除
                </Button>
              </Tooltip>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [canManage, router],
  );

  if (initializing) {
    return <p className="text-sm text-[var(--gray-11)]">Loading mind maps...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问思维导图页面。</p>
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
    return <p className="text-sm text-[var(--gray-11)]">缺少 `question_bank.read` 或 `question_bank.manage` 权限。</p>;
  }

  return (
    <main className="flex flex-col gap-4">
      <section className="rounded-xl border border-[var(--gray-6)] bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[var(--gray-12)]">思维导图</h1>
            <p className="text-sm text-[var(--gray-11)]">使用老工程 `mind_map` 表结构与流程，管理导图并进入编辑页。</p>
          </div>
          <Space>
            <Button type="primary" onClick={openCreate} disabled={!canManage}>
              新建思维导图
            </Button>
            <Tag color="blue">总数 {pagination.total}</Tag>
          </Space>
        </div>

        <Form form={searchForm} layout="inline" onFinish={handleSearch} initialValues={{ map_name: "" }}>
          <Form.Item name="map_name" label="导图名称">
            <Input allowClear placeholder="输入关键字" style={{ width: 260 }} />
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
        <Table<MindMapSummary>
          rowKey="id"
          loading={loading}
          dataSource={items}
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
        title="新建思维导图"
        open={createVisible}
        onCancel={() => setCreateVisible(false)}
        onOk={() => void handleCreate()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="map_name" label="导图名称" rules={[{ required: true, message: "请输入导图名称" }]}>
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item name="descr" label="描述">
            <Input.TextArea rows={4} maxLength={20000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑导图信息"
        open={editVisible}
        onCancel={() => {
          setEditVisible(false);
          setCurrent(null);
        }}
        onOk={() => void handleEditBasicInfo()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="map_name" label="导图名称" rules={[{ required: true, message: "请输入导图名称" }]}>
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item name="descr" label="描述">
            <Input.TextArea rows={4} maxLength={20000} />
          </Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
