"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { MenuItem, PermissionItem, RoleItem, RoleListResponse } from "@/types/auth";

type PermissionResponse = { items: PermissionItem[] };
type MenuListResponse = { items: MenuItem[]; total: number };

const EMPTY_FORM = {
  code: "",
  name: "",
  permission_codes: "",
  menu_ids: [] as number[],
};

export default function AdminRolesPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canRead = hasPermission("role.read") || hasPermission("role.manage");
  const canManage = hasPermission("role.manage");

  const menuOptions = useMemo(
    () => menus.map((menu) => ({ value: menu.id, label: `${menu.name} (${menu.code})` })),
    [menus],
  );

  const loadData = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const [roleRes, permissionRes, menuRes] = await Promise.all([
      fetchWithAuth("/api/v1/admin/roles"),
      fetchWithAuth("/api/v1/admin/permissions"),
      fetchWithAuth("/api/v1/admin/menus"),
    ]);

    if (!roleRes.ok) {
      setError(await readApiError(roleRes));
      setLoading(false);
      return;
    }
    if (!permissionRes.ok) {
      setError(await readApiError(permissionRes));
      setLoading(false);
      return;
    }
    if (!menuRes.ok) {
      setError(await readApiError(menuRes));
      setLoading(false);
      return;
    }

    const rolePayload = (await roleRes.json()) as RoleListResponse;
    const permissionPayload = (await permissionRes.json()) as PermissionResponse;
    const menuPayload = (await menuRes.json()) as MenuListResponse;

    setRoles(rolePayload.items);
    setPermissions(permissionPayload.items);
    setMenus(menuPayload.items);
    setLoading(false);
  }, [canRead, fetchWithAuth]);

  useEffect(() => {
    if (!user || !canRead) {
      return;
    }
    queueMicrotask(() => {
      void loadData();
    });
  }, [canRead, loadData, user]);

  useTopicSubscription("admin.roles", useCallback(() => {
    if (user && canRead) {
      void loadData();
    }
  }, [canRead, loadData, user]));

  useTopicSubscription("admin.menus", useCallback(() => {
    if (user && canRead) {
      void loadData();
    }
  }, [canRead, loadData, user]));

  const resetForm = () => {
    setEditingRoleId(null);
    setForm(EMPTY_FORM);
  };

  const startEdit = (role: RoleItem) => {
    setEditingRoleId(role.id);
    setForm({
      code: role.code,
      name: role.name,
      permission_codes: role.permission_codes.join(", "),
      menu_ids: role.menu_ids,
    });
  };

  const submit = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      permission_codes: form.permission_codes
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      menu_ids: form.menu_ids,
    };

    const response = editingRoleId
      ? await fetchWithAuth(`/api/v1/admin/roles/${editingRoleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: payload.name,
            permission_codes: payload.permission_codes,
            menu_ids: payload.menu_ids,
          }),
        })
      : await fetchWithAuth("/api/v1/admin/roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    if (!response.ok) {
      setError(await readApiError(response));
      setSaving(false);
      return;
    }

    setSuccess(editingRoleId ? "角色已更新" : "角色已创建");
    resetForm();
    await loadData();
    setSaving(false);
  };

  const removeRole = async (role: RoleItem) => {
    if (!window.confirm(`确认删除角色 ${role.code} 吗？`)) {
      return;
    }
    setError("");
    setSuccess("");
    const response = await fetchWithAuth(`/api/v1/admin/roles/${role.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError(await readApiError(response));
      return;
    }
    setSuccess("角色已删除");
    if (editingRoleId === role.id) {
      resetForm();
    }
    await loadData();
  };

  if (initializing || loading) {
    return <p className="text-sm text-muted">Loading roles...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">请先登录后再访问角色管理页面。</p>
        <Link href="/" className="btn-secondary w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">你没有访问该页面的权限（需要 `role.read`）。</p>
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
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">角色列表</h2>
            <p className="mt-1 text-sm text-muted">当前已配置 {roles.length} 个角色。</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table-modern min-w-full text-left text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Permissions</th>
                <th className="px-4 py-3 font-medium">Menus</th>
                {canManage && <th className="px-4 py-3 font-medium">操作</th>}
              </tr>
            </thead>
            <tbody className="table-body divide-y">
              {roles.map((role) => (
                <tr key={role.id}>
                  <td className="px-4 py-3 font-mono text-xs">{role.code}</td>
                  <td className="px-4 py-3">{role.name}</td>
                  <td className="px-4 py-3">{role.permission_codes.join(", ") || "-"}</td>
                  <td className="px-4 py-3">{role.menu_ids.join(", ") || "-"}</td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          className="btn-secondary btn-small"
                          onClick={() => startEdit(role)}
                          type="button"
                        >
                          编辑
                        </button>
                        {!['admin', 'user'].includes(role.code) && (
                          <button
                            className="btn-danger btn-small"
                            onClick={() => void removeRole(role)}
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
        <section className="surface-card">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{editingRoleId ? "编辑角色" : "新建角色"}</h2>
              <p className="mt-1 text-sm text-muted">角色绑定权限点和可见菜单。</p>
            </div>
            {editingRoleId && (
              <button className="btn-secondary w-fit" type="button" onClick={resetForm}>取消编辑</button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span>角色编码</span>
              <input
                value={form.code}
                disabled={editingRoleId !== null}
                onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                className="control w-full"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>角色名称</span>
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                className="control w-full"
              />
            </label>
            <label className="space-y-2 text-sm md:col-span-2">
              <span>权限编码（逗号分隔）</span>
              <input
                value={form.permission_codes}
                onChange={(event) => setForm((prev) => ({ ...prev, permission_codes: event.target.value }))}
                placeholder={permissions.map((item) => item.code).join(", ")}
                className="control w-full"
              />
            </label>
            <div className="space-y-2 text-sm md:col-span-2">
              <span>可见菜单</span>
              <div className="grid gap-2 surface-card-muted p-3 md:grid-cols-2">
                {menuOptions.map((item) => {
                  const checked = form.menu_ids.includes(item.value);
                  return (
                    <label key={item.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setForm((prev) => ({
                            ...prev,
                            menu_ids: event.target.checked
                              ? [...prev.menu_ids, item.value]
                              : prev.menu_ids.filter((menuId) => menuId !== item.value),
                          }));
                        }}
                      />
                      <span>{item.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <button
              className="btn-primary"
              disabled={saving}
              onClick={() => void submit()}
              type="button"
            >
              {saving ? "提交中..." : editingRoleId ? "保存修改" : "创建角色"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
