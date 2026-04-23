"use client";

import { ChangeEvent, useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { RowActionMenu, type RowActionMenuItem } from "@/components/row-action-menu";
import { Checkbox, Dialog, Select, TextField, Button, Table } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { MenuItem, MenuListResponse } from "@/types/auth";

const EMPTY_FORM = {
  code: "",
  name: "",
  path: "",
  icon: "",
  parent_id: "",
  type: "menu",
  sort_order: "0",
  status: "enabled",
  visible: true,
  cacheable: false,
  component: "",
  permission_code: "",
};

type SortKey = "sort_order" | "id" | "name";

type SortOption = {
  key: SortKey;
  label: string;
};

const SORT_OPTIONS: SortOption[] = [
  { key: "sort_order", label: "按排序值" },
  { key: "id", label: "按 ID" },
  { key: "name", label: "按名称" },
];
const NO_PARENT_OPTION = "__no_parent__";

export default function AdminMenusPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingMenuId, setEditingMenuId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [sortKey, setSortKey] = useState<SortKey>("sort_order");

  const canRead = hasPermission("menu.read") || hasPermission("menu.manage");
  const canManage = hasPermission("menu.manage");
  const protectedMenuCodes = new Set(["dashboard", "admin.users", "admin.roles", "admin.menus", "admin.system_params", "admin.wxapp", "admin.system_message", "admin.code_review", "admin.git_desktop", "admin.agent", "admin.mcp_server", "admin.files", "admin.filedetector", "admin.baidu_pan", "admin.requirements", "admin.data_query", "admin.hot_search", "admin.schedule", "admin.cron_task_mgr", "admin.queue_mgr", "admin.todos", "admin.mindmap", "admin.knowledge_mastery", "admin.mdresolve", "admin.mermaid_mgr", "admin.tag", "admin.knowledge_point_mgr", "admin.question_bank", "admin.homework", "admin.job_mgr", "admin.history", "admin.vocabulary", "admin.diary", "admin.syslog", "admin.chat", "admin.models", "admin.password", "admin.token_usage", "admin.jwt_generator", "admin.life_countdown", "admin.api_tester", "admin.orchestration"]);
  const parentOptions = useMemo(() => menus.map((menu) => ({ id: menu.id, label: `${menu.name} (${menu.code})` })), [menus]);

  const menuNameById = useMemo(() => {
    const map = new Map<number, string>();
    menus.forEach((menu) => {
      map.set(menu.id, `${menu.name} (${menu.code})`);
    });
    return map;
  }, [menus]);

  const filteredMenus = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return menus
      .filter((menu) => {
        if (statusFilter !== "all" && menu.status !== statusFilter) {
          return false;
        }
        if (!query) {
          return true;
        }
        const haystack = [menu.code, menu.name, menu.path ?? "", menu.permission_code ?? ""]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        if (sortKey === "name") {
          return a.name.localeCompare(b.name, "zh-CN");
        }
        if (sortKey === "id") {
          return a.id - b.id;
        }
        if (a.sort_order !== b.sort_order) {
          return a.sort_order - b.sort_order;
        }
        return a.id - b.id;
      });
  }, [keyword, menus, sortKey, statusFilter]);

  const stats = useMemo(() => {
    const enabled = menus.filter((item) => item.status === "enabled").length;
    const disabled = menus.filter((item) => item.status === "disabled").length;
    const topLevel = menus.filter((item) => item.parent_id === null).length;
    return { total: menus.length, enabled, disabled, topLevel };
  }, [menus]);

  const loadMenus = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    const response = await fetchWithAuth("/api/v1/admin/menus");
    if (!response.ok) {
      setError(await readApiError(response));
      setLoading(false);
      return;
    }
    const payload = (await response.json()) as MenuListResponse;
    setMenus(payload.items);
    setLoading(false);
  }, [canRead, fetchWithAuth]);

  useEffect(() => {
    if (!user || !canRead) {
      return;
    }
    queueMicrotask(() => {
      void loadMenus();
    });
  }, [canRead, loadMenus, user]);

  useTopicSubscription("admin.menus", useCallback(() => {
    if (user && canRead) {
      void loadMenus();
    }
  }, [canRead, loadMenus, user]));

  const resetForm = () => {
    setEditingMenuId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(false);
  };

  const startCreate = () => {
    setEditingMenuId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const startEdit = (menu: MenuItem) => {
    setEditingMenuId(menu.id);
    setForm({
      code: menu.code,
      name: menu.name,
      path: menu.path ?? "",
      icon: menu.icon ?? "",
      parent_id: menu.parent_id ? String(menu.parent_id) : "",
      type: menu.type,
      sort_order: String(menu.sort_order),
      status: menu.status,
      visible: menu.visible,
      cacheable: menu.cacheable,
      component: menu.component ?? "",
      permission_code: menu.permission_code ?? "",
    });
    setDialogOpen(true);
  };

  const submit = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      path: form.path.trim() || null,
      icon: form.icon.trim() || null,
      parent_id: form.parent_id ? Number(form.parent_id) : null,
      type: form.type,
      sort_order: Number(form.sort_order || 0),
      status: form.status,
      visible: form.visible,
      cacheable: form.cacheable,
      component: form.component.trim() || null,
      permission_code: form.permission_code.trim() || null,
    };

    const response = editingMenuId
      ? await fetchWithAuth(`/api/v1/admin/menus/${editingMenuId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetchWithAuth("/api/v1/admin/menus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    if (!response.ok) {
      setError(await readApiError(response));
      setSaving(false);
      return;
    }

    setSuccess(editingMenuId ? "菜单已更新" : "菜单已创建");
    resetForm();
    await loadMenus();
    setSaving(false);
  };

  const removeMenu = async (menu: MenuItem) => {
    if (!window.confirm(`确认删除菜单 ${menu.name} (${menu.code}) 吗？`)) {
      return;
    }
    setError("");
    setSuccess("");
    const response = await fetchWithAuth(`/api/v1/admin/menus/${menu.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError(await readApiError(response));
      return;
    }
    setSuccess("菜单已删除");
    if (editingMenuId === menu.id) {
      resetForm();
    }
    await loadMenus();
  };

  if (initializing || loading) {
    return <p className="text-sm text-[var(--gray-11)]">Loading menus...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问菜单管理页面。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `menu.read`）。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <pre className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{error}</pre>
      )}
      {success && (
        <pre className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--green-6)] bg-[var(--green-a2)] p-4 text-sm text-[var(--green-11)]">{success}</pre>
      )}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">菜单列表</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">维护后台导航菜单与访问权限。</p>
          </div>
          {canManage && (
            <Button type="button" onClick={startCreate}>新建菜单</Button>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-[var(--gray-11)]">总菜单数</p>
            <p className="text-xl font-semibold">{stats.total}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-[var(--gray-11)]">启用</p>
            <p className="text-xl font-semibold text-[var(--green-11)]">{stats.enabled}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-[var(--gray-11)]">禁用</p>
            <p className="text-xl font-semibold text-[var(--amber-11)]">{stats.disabled}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-[var(--gray-11)]">顶级菜单</p>
            <p className="text-xl font-semibold">{stats.topLevel}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">关键词</span>
            <TextField.Root
              value={keyword}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyword(event.currentTarget.value)}
              placeholder="按编码/名称/路径/权限筛选"
              className="w-full"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">状态</span>
            <Select.Root
              value={statusFilter}
              onValueChange={(value: string) => setStatusFilter(value as "all" | "enabled" | "disabled")}
            >
              <Select.Trigger className="w-full" />
              <Select.Content>
                <Select.Item value="all">全部</Select.Item>
                <Select.Item value="enabled">已启用</Select.Item>
                <Select.Item value="disabled">已禁用</Select.Item>
              </Select.Content>
            </Select.Root>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">排序方式</span>
            <Select.Root value={sortKey} onValueChange={(value: string) => setSortKey(value as SortKey)}>
              <Select.Trigger className="w-full" />
              <Select.Content>
                {SORT_OPTIONS.map((option) => (
                  <Select.Item key={option.key} value={option.key}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </label>
        </div>

        <div className="mt-4 overflow-x-auto">
          <Table.Root className="w-full min-w-full text-left text-sm">
            <Table.Header className="bg-[var(--gray-a3)]">
              <Table.Row>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">ID</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">编码</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">名称</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">路径</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">权限码</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">父菜单</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">排序</Table.ColumnHeaderCell>
                {canManage && <Table.ColumnHeaderCell className="px-4 py-3 font-medium">操作</Table.ColumnHeaderCell>}
              </Table.Row>
            </Table.Header>
            <Table.Body className="divide-y divide-y">
              {filteredMenus.map((menu) => {
                const actionItems: RowActionMenuItem[] = [
                  {
                    key: "edit",
                    label: "编辑",
                    onSelect: () => startEdit(menu),
                  },
                ];
                if (!protectedMenuCodes.has(menu.code)) {
                  actionItems.push({
                    key: "delete",
                    label: "删除",
                    color: "red",
                    onSelect: () => {
                      void removeMenu(menu);
                    },
                  });
                }

                return (
                  <Table.Row key={menu.id}>
                    <Table.Cell className="px-4 py-3">{menu.id}</Table.Cell>
                    <Table.Cell className="px-4 py-3 font-mono text-xs">{menu.code}</Table.Cell>
                    <Table.Cell className="px-4 py-3">{menu.name}</Table.Cell>
                    <Table.Cell className="px-4 py-3">{menu.path ?? "-"}</Table.Cell>
                    <Table.Cell className="px-4 py-3">{menu.permission_code ?? "-"}</Table.Cell>
                    <Table.Cell className="px-4 py-3">{menu.parent_id ? (menuNameById.get(menu.parent_id) ?? menu.parent_id) : "-"}</Table.Cell>
                    <Table.Cell className="px-4 py-3">{menu.sort_order}</Table.Cell>
                    {canManage && (
                      <Table.Cell className="px-4 py-3">
                        <RowActionMenu items={actionItems} />
                      </Table.Cell>
                    )}
                  </Table.Row>
                );
              })}
              {filteredMenus.length === 0 && (
                <Table.Row>
                  <Table.Cell className="px-4 py-10 text-center text-sm text-[var(--gray-11)]" colSpan={canManage ? 8 : 7}>
                    未找到符合筛选条件的菜单项。
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
        </div>
      </section>

      {canManage && (
        <Dialog.Root
          open={dialogOpen}
          onOpenChange={(open: boolean) => {
            if (!open) {
              resetForm();
            }
          }}
        >
          <Dialog.Content className="max-h-[85vh] w-full max-w-2xl overflow-auto">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{editingMenuId ? "编辑菜单" : "新建菜单"}</h2>
                <p className="mt-1 text-sm text-[var(--gray-11)]">支持层级菜单、权限码和排序。</p>
              </div>
              <Button className="w-fit" color="gray" type="button" variant="soft" onClick={resetForm}>取消</Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span>菜单编码</span>
                <TextField.Root
                  value={form.code}
                  disabled={editingMenuId !== null}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, code: event.currentTarget.value }))}
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>菜单名称</span>
                <TextField.Root
                  value={form.name}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, name: event.currentTarget.value }))}
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>路由路径</span>
                <TextField.Root
                  value={form.path}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, path: event.currentTarget.value }))}
                  placeholder="/admin/example"
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>图标名</span>
                <TextField.Root
                  value={form.icon}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, icon: event.currentTarget.value }))}
                  placeholder="LayoutDashboard"
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>父菜单</span>
                <Select.Root
                  value={form.parent_id || NO_PARENT_OPTION}
                  onValueChange={(value: string) =>
                    setForm((prev) => ({ ...prev, parent_id: value === NO_PARENT_OPTION ? "" : value }))
                  }
                >
                  <Select.Trigger className="w-full" />
                  <Select.Content>
                    <Select.Item value={NO_PARENT_OPTION}>无</Select.Item>
                    {parentOptions
                      .filter((item) => item.id !== editingMenuId)
                      .map((item) => (
                        <Select.Item key={item.id} value={String(item.id)}>
                          {item.label}
                        </Select.Item>
                      ))}
                  </Select.Content>
                </Select.Root>
              </label>
              <label className="space-y-2 text-sm">
                <span>类型</span>
                <Select.Root value={form.type} onValueChange={(value: string) => setForm((prev) => ({ ...prev, type: value }))}>
                  <Select.Trigger className="w-full" />
                  <Select.Content>
                    <Select.Item value="directory">目录</Select.Item>
                    <Select.Item value="menu">菜单</Select.Item>
                    <Select.Item value="button">按钮</Select.Item>
                  </Select.Content>
                </Select.Root>
              </label>
              <label className="space-y-2 text-sm">
                <span>排序</span>
                <TextField.Root
                  value={form.sort_order}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, sort_order: event.currentTarget.value }))}
                  type="number"
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>状态</span>
                <Select.Root value={form.status} onValueChange={(value: string) => setForm((prev) => ({ ...prev, status: value }))}>
                  <Select.Trigger className="w-full" />
                  <Select.Content>
                    <Select.Item value="enabled">已启用</Select.Item>
                    <Select.Item value="disabled">已禁用</Select.Item>
                  </Select.Content>
                </Select.Root>
              </label>
              <label className="space-y-2 text-sm">
                <span>组件标识</span>
                <TextField.Root
                  value={form.component}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, component: event.currentTarget.value }))}
                  placeholder="app/admin/users/page"
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>权限码</span>
                <TextField.Root
                  value={form.permission_code}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, permission_code: event.currentTarget.value }))}
                  placeholder="menu.read"
                  className="w-full"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.visible}
                  onCheckedChange={(checked: boolean | "indeterminate") => setForm((prev) => ({ ...prev, visible: checked === true }))}
                />
                <span>可见</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.cacheable}
                  onCheckedChange={(checked: boolean | "indeterminate") => setForm((prev) => ({ ...prev, cacheable: checked === true }))}
                />
                <span>可缓存</span>
              </label>
            </div>

            <div className="mt-4">
              <Button
               
                disabled={saving}
                onClick={() => void submit()}
                type="button"
              >
                {saving ? "提交中..." : editingMenuId ? "保存修改" : "创建菜单"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </div>
  );
}
