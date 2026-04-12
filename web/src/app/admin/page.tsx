"use client";

import Link from "next/link";

import { useAuth } from "@/components/auth-provider";

const CARDS = [
  {
    href: "/admin/users",
    title: "用户管理",
    description: "查看用户、分配角色、维护账号状态。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("user.manage"),
  },
  {
    href: "/admin/roles",
    title: "角色管理",
    description: "配置角色、绑定权限点、分配菜单可见范围。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("role.read") || hasPermission("role.manage"),
  },
  {
    href: "/admin/menus",
    title: "菜单管理",
    description: "维护后台导航、菜单层级和菜单对应权限。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("menu.read") || hasPermission("menu.manage"),
  },
  {
    href: "/admin/files",
    title: "文件管理",
    description: "管理挂载点文件列表、目录浏览、目录创建和删除。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("file.read") || hasPermission("file.manage"),
  },
  {
    href: "/admin/requirements",
    title: "需求管理",
    description: "查看需求列表、流转处理、评论协作和操作留痕。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("requirement.read"),
  },
  {
    href: "/admin/models",
    title: "模型管理",
    description: "管理模型编码、状态流转、路由规则、密钥轮换与健康检查。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("model.read") || hasPermission("model.manage"),
  },
];

export default function AdminHomePage() {
  const { hasPermission } = useAuth();
  const visibleCards = CARDS.filter((item) => item.visible(hasPermission));

  if (visibleCards.length === 0) {
    return (
      <div className="rounded-2xl border border-black/10 bg-white p-5 text-sm text-zinc-500 shadow-sm dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400">
        当前账号暂无可访问的后台模块。
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
      {visibleCards.map((item) => (
        <Link key={item.href} href={item.href} className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">{item.title}</h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{item.description}</p>
        </Link>
      ))}
    </div>
  );
}
