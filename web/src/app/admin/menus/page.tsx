"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
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

export default function AdminMenusPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingMenuId, setEditingMenuId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canRead = hasPermission("menu.read") || hasPermission("menu.manage");
  const canManage = hasPermission("menu.manage");
  const protectedMenuCodes = new Set(["dashboard", "admin.users", "admin.roles", "admin.menus", "admin.models"]);
  const parentOptions = useMemo(() => menus.map((menu) => ({ id: menu.id, label: `${menu.name} (${menu.code})` })), [menus]);

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
    return <p className="text-sm text-zinc-500">Loading menus...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">请先登录后再访问菜单管理页面。</p>
        <Link href="/" className="text-sm underline">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">你没有访问该页面的权限（需要 `menu.read`）。</p>
        <Link href="/" className="text-sm underline">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <pre className="overflow-auto rounded-xl border border-red-500/30 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300">{error}</pre>
      )}
      {success && (
        <pre className="overflow-auto rounded-xl border border-emerald-500/30 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-300">{success}</pre>
      )}

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">菜单列表</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">维护后台导航菜单与访问权限。</p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-black/10 text-left text-sm dark:divide-white/10">
            <thead className="bg-black/[0.03] dark:bg-white/[0.04]">
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
            <tbody className="divide-y divide-black/10 dark:divide-white/10">
              {menus.map((menu) => (
                <tr key={menu.id}>
                  <td className="px-4 py-3">{menu.id}</td>
                  <td className="px-4 py-3 font-mono text-xs">{menu.code}</td>
                  <td className="px-4 py-3">{menu.name}</td>
                  <td className="px-4 py-3">{menu.path ?? "-"}</td>
                  <td className="px-4 py-3">{menu.permission_code ?? "-"}</td>
                  <td className="px-4 py-3">{menu.parent_id ?? "-"}</td>
                  <td className="px-4 py-3">{menu.sort_order}</td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          className="rounded-md border border-black/15 px-3 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                          onClick={() => startEdit(menu)}
                          type="button"
                        >
                          编辑
                        </button>
                        {!protectedMenuCodes.has(menu.code) && (
                          <button
                            className="rounded-md border border-red-500/30 px-3 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
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
            </tbody>
          </table>
        </div>
      </section>

      {canManage && (
        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{editingMenuId ? "编辑菜单" : "新建菜单"}</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">支持层级菜单、权限码和排序。</p>
            </div>
            {editingMenuId && (
              <button className="text-sm underline" type="button" onClick={resetForm}>取消编辑</button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span>菜单编码</span>
              <input
                value={form.code}
                disabled={editingMenuId !== null}
                onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 disabled:opacity-60 dark:border-white/20 dark:focus:border-white/40"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>菜单名称</span>
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>路由路径</span>
              <input
                value={form.path}
                onChange={(event) => setForm((prev) => ({ ...prev, path: event.target.value }))}
                placeholder="/admin/example"
                className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>图标名</span>
              <input
                value={form.icon}
                onChange={(event) => setForm((prev) => ({ ...prev, icon: event.target.value }))}
                placeholder="LayoutDashboard"
                className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>父菜单</span>
              <select
                value={form.parent_id}
                onChange={(event) => setForm((prev) => ({ ...prev, parent_id: event.target.value }))}
                className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
              >
                <option value="">无</option>
                {parentOptions
                  .filter((item) => item.id !== editingMenuId)
                  .map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span>类型</span>
              <select
                value={form.type}
                onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}
                className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
              >
                <option value="directory">directory</option>
                <option value="menu">menu</option>
                <option value="button">button</option>
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span>排序</span>
              <input
                value={form.sort_order}
                onChange={(event) => setForm((prev) => ({ ...prev, sort_order: event.target.value }))}
                type="number"
                className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>状态</span>
              <select
                value={form.status}
                onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
              >
                <option value="enabled">enabled</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span>组件标识</span>
              <input
                value={form.component}
                onChange={(event) => setForm((prev) => ({ ...prev, component: event.target.value }))}
                placeholder="app/admin/users/page"
                className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>权限码</span>
              <input
                value={form.permission_code}
                onChange={(event) => setForm((prev) => ({ ...prev, permission_code: event.target.value }))}
                placeholder="menu.read"
                className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
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
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
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
