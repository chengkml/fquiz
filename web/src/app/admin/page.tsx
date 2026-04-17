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
    href: "/admin/chat",
    title: "AI 聊天",
    description: "基于模型路由规则发起多轮对话并保留会话记录。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("chat.use"),
  },
  {
    href: "/admin/requirements",
    title: "需求管理",
    description: "查看需求列表、流转处理、评论协作和操作留痕。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("requirement.read"),
  },
  {
    href: "/admin/todos",
    title: "待办管理",
    description: "基于 HeroUI 快速维护待办事项、状态流转与执行节奏。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("todo.read"),
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
      <div className="surface-card text-sm text-muted">
        当前账号暂无可访问的后台模块。
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {visibleCards.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="surface-card group relative overflow-hidden transition hover:-translate-y-0.5 hover:border-indigo-200"
        >
          <div className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-indigo-200/40 blur-xl transition group-hover:bg-indigo-300/45" />
          <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
          <p className="mt-2 text-sm text-muted">{item.description}</p>
          <p className="mt-5 inline-flex items-center text-xs font-medium text-indigo-700">
            查看模块
          </p>
        </Link>
      ))}
    </div>
  );
}
