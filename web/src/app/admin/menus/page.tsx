"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { Select, TextField } from "@radix-ui/themes";
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
  const [form, setForm] = useState(EMPTY_FORM);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [sortKey, setSortKey] = useState<SortKey>("sort_order");

  const canRead = hasPermission("menu.read") || hasPermission("menu.manage");
  const canManage = hasPermission("menu.manage");
  const protectedMenuCodes = new Set(["dashboard", "admin.users", "admin.roles", "admin.menus", "admin.files", "admin.requirements", "admin.models"]);
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
    return <p className="text-sm text-muted">Loading menus...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">请先登录后再访问菜单管理页面。</p>
        <Link href="/" className="btn-secondary w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">你没有访问该页面的权限（需要 `menu.read`）。</p>
        <Link href="/" className="btn-secondary w-fit">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <pre className="notice notice-error">{error}</pre>
      )}
      {success && (
        <pre className="notice notice-success">{success}</pre>
      )}

      <section className="surface-card">
        <h2 className="text-lg font-semibold">菜单列表</h2>
        <p className="mt-1 text-sm text-muted">维护后台导航菜单与访问权限。</p>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted">总菜单数</p>
            <p className="text-xl font-semibold">{stats.total}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted">启用</p>
            <p className="text-xl font-semibold text-emerald-600">{stats.enabled}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted">禁用</p>
            <p className="text-xl font-semibold text-amber-600">{stats.disabled}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted">顶级菜单</p>
            <p className="text-xl font-semibold">{stats.topLevel}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted">关键词</span>
            <TextField.Root
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="按编码/名称/路径/权限筛选"
              className="w-full"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">状态</span>
            <Select.Root
              value={statusFilter}
              onValueChange={(value: string) => setStatusFilter(value as "all" | "enabled" | "disabled")}
            >
              <Select.Trigger className="w-full" />
              <Select.Content>
                <Select.Item value="all">全部</Select.Item>
                <Select.Item value="enabled">enabled</Select.Item>
                <Select.Item value="disabled">disabled</Select.Item>
              </Select.Content>
            </Select.Root>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">排序方式</span>
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
          <table className="table-modern min-w-full text-left text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Path</th>
                <th className="px-4 py-3 font-medium">Permission</th>
                <th className="px-4 py-3 font-medium">Parent</th>
                <th className="px-4 py-3 font-medium">Sort</th>
                {canManage && <th className="px-4 py-3 font-medium">操作</th>}
              </tr>
            </thead>
            <tbody className="table-body divide-y">
              {filteredMenus.map((menu) => (
                <tr key={menu.id}>
                  <td className="px-4 py-3">{menu.id}</td>
                  <td className="px-4 py-3 font-mono text-xs">{menu.code}</td>
                  <td className="px-4 py-3">{menu.name}</td>
                  <td className="px-4 py-3">{menu.path ?? "-"}</td>
                  <td className="px-4 py-3">{menu.permission_code ?? "-"}</td>
                  <td className="px-4 py-3">{menu.parent_id ? (menuNameById.get(menu.parent_id) ?? menu.parent_id) : "-"}</td>
                  <td className="px-4 py-3">{menu.sort_order}</td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          className="btn-secondary btn-small"
                          onClick={() => startEdit(menu)}
                          type="button"
                        >
                          编辑
                        </button>
                        {!protectedMenuCodes.has(menu.code) && (
                          <button
                            className="btn-danger btn-small"
                            onClick={() => void removeMenu(menu)}
                            type="button"
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {filteredMenus.length === 0 && (
                <tr>
                  <td className="px-4 py-10 text-center text-sm text-muted" colSpan={canManage ? 8 : 7}>
                    未找到符合筛选条件的菜单项。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {canManage && (
        <section className="surface-card">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{editingMenuId ? "编辑菜单" : "新建菜单"}</h2>
              <p className="mt-1 text-sm text-muted">支持层级菜单、权限码和排序。</p>
            </div>
            {editingMenuId && (
              <button className="btn-secondary w-fit" type="button" onClick={resetForm}>取消编辑</button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span>菜单编码</span>
              <TextField.Root
                value={form.code}
                disabled={editingMenuId !== null}
                onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                className="w-full"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>菜单名称</span>
              <TextField.Root
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>路由路径</span>
              <TextField.Root
                value={form.path}
                onChange={(event) => setForm((prev) => ({ ...prev, path: event.target.value }))}
                placeholder="/admin/example"
                className="w-full"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>图标名</span>
              <TextField.Root
                value={form.icon}
                onChange={(event) => setForm((prev) => ({ ...prev, icon: event.target.value }))}
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
                  <Select.Item value="directory">directory</Select.Item>
                  <Select.Item value="menu">menu</Select.Item>
                  <Select.Item value="button">button</Select.Item>
                </Select.Content>
              </Select.Root>
            </label>
            <label className="space-y-2 text-sm">
              <span>排序</span>
              <TextField.Root
                value={form.sort_order}
                onChange={(event) => setForm((prev) => ({ ...prev, sort_order: event.target.value }))}
                type="number"
                className="w-full"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>状态</span>
              <Select.Root value={form.status} onValueChange={(value: string) => setForm((prev) => ({ ...prev, status: value }))}>
                <Select.Trigger className="w-full" />
                <Select.Content>
                  <Select.Item value="enabled">enabled</Select.Item>
                  <Select.Item value="disabled">disabled</Select.Item>
                </Select.Content>
              </Select.Root>
            </label>
            <label className="space-y-2 text-sm">
              <span>组件标识</span>
              <TextField.Root
                value={form.component}
                onChange={(event) => setForm((prev) => ({ ...prev, component: event.target.value }))}
                placeholder="app/admin/users/page"
                className="w-full"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>权限码</span>
              <TextField.Root
                value={form.permission_code}
                onChange={(event) => setForm((prev) => ({ ...prev, permission_code: event.target.value }))}
                placeholder="menu.read"
                className="w-full"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.visible} onChange={(event) => setForm((prev) => ({ ...prev, visible: event.target.checked }))} />
              <span>可见</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.cacheable} onChange={(event) => setForm((prev) => ({ ...prev, cacheable: event.target.checked }))} />
              <span>可缓存</span>
            </label>
          </div>

          <div className="mt-4">
            <button
              className="btn-primary"
              disabled={saving}
              onClick={() => void submit()}
              type="button"
            >
              {saving ? "提交中..." : editingMenuId ? "保存修改" : "创建菜单"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
