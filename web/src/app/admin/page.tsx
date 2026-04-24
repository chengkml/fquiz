"use client";

import Link from "next/link";
import { Card, Flex, Heading, Text } from "@/components/ui-antd";

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
    href: "/admin/system-params",
    title: "系统参数",
    description: "维护系统级参数键值、启停状态与变更说明。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("system_param.read") || hasPermission("system_param.manage"),
  },
  {
    href: "/admin/prompt",
    title: "提示词管理",
    description: "复用系统消息能力维护提示词内容、等级、有效期与发布状态。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("system_message.read") || hasPermission("system_message.manage"),
  },
  {
    href: "/admin/inbox",
    title: "收件箱",
    description: "迁移自 Multica 的通知收件箱视图，支持已读与归档管理。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("menu.read") || hasPermission("menu.manage"),
  },
  {
    href: "/admin/chat",
    title: "AI 聊天",
    description: "基于模型路由规则发起多轮对话并保留会话记录。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("chat.use"),
  },
  {
    href: "/admin/code-review",
    title: "代码评审",
    description: "查看代码评审任务、状态流转、评论协作与处理留痕。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("requirement.read"),
  },
  {
    href: "/admin/git-desktop",
    title: "Git管理",
    description: "复用需求管理能力维护 Git 相关需求，统一跟踪分支、状态与协作流程。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("requirement.read"),
  },
  {
    href: "/admin/orchestration",
    title: "编排管理",
    description: "维护编排路由（AGENT）规则，绑定目标模型并控制优先级与启停状态。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("model.read") || hasPermission("model.manage"),
  },
  {
    href: "/admin/mcp-server",
    title: "MCP管理",
    description: "复用模型与路由规则能力，统一管理 MCP Server 相关编排与启停配置。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("model.read") || hasPermission("model.manage"),
  },
  {
    href: "/admin/mermaid-mgr",
    title: "流程图",
    description: "复用 MD 解析能力，将流程图文档快速解析并导入结构化题目。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("question_bank.read") || hasPermission("question_bank.manage"),
  },
  {
    href: "/admin/requirements",
    title: "需求管理",
    description: "查看需求列表、流转处理、评论协作和操作留痕。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("requirement.read"),
  },
  {
    href: "/admin/mindmap",
    title: "思维导图",
    description: "管理思维导图列表，支持编辑导图 JSON、AI 生成和待办一键初始化。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("question_bank.read") || hasPermission("question_bank.manage"),
  },
  {
    href: "/admin/schedule",
    title: "日程管理",
    description: "按日程维度管理待办事项，支持筛选、状态流转与负责人协作。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("todo.read"),
  },
  {
    href: "/admin/knowledge-set",
    title: "知识集管理",
    description: "复用文件管理能力维护知识集目录与文件，支持挂载切换、上传、重命名与移动。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("file.read") || hasPermission("file.manage"),
  },
  {
    href: "/admin/syslog",
    title: "系统日志",
    description: "查看鉴权与会话类审计日志，支持动作与用户筛选。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("menu.read") || hasPermission("menu.manage"),
  },
  {
    href: "/admin/api-tester",
    title: "API测试",
    description: "复用模型测试能力执行冒烟测试与对话测试，支持查看最近测试记录。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("model.read") || hasPermission("model.manage"),
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
      <Card size="2">
        <Text color="gray" size="2">当前账号暂无可访问的后台模块。</Text>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {visibleCards.map((item) => (
        <Card key={item.href} asChild size="2" className="h-full">
          <Link href={item.href}>
            <Flex direction="column" gap="2">
              <Heading as="h2" size="4">{item.title}</Heading>
              <Text size="2" color="gray">{item.description}</Text>
              <Text size="1" color="gray">查看模块</Text>
            </Flex>
          </Link>
        </Card>
      ))}
    </div>
  );
}
