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
    href: "/admin/wxapp",
    title: "微信小程序",
    description: "复用系统参数能力维护微信小程序配置项、启停状态与说明信息。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("system_param.read") || hasPermission("system_param.manage"),
  },
  {
    href: "/admin/prompt",
    title: "提示词管理",
    description: "复用系统消息能力维护提示词内容、等级、有效期与发布状态。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("system_message.read") || hasPermission("system_message.manage"),
  },
  {
    href: "/admin/chat",
    title: "AI 聊天",
    description: "基于模型路由规则发起多轮对话并保留会话记录。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("chat.use"),
  },
  {
    href: "/admin/jwt-generator",
    title: "Jwt生成器",
    description: "为指定用户生成 Bearer Token，便于联调鉴权与权限定位。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("jwt_generator.read") || hasPermission("jwt_generator.manage"),
  },
  {
    href: "/admin/life-countdown",
    title: "生命倒计时",
    description: "设定死亡日期、查看生命倒计时，并生成今日警示语。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("life_countdown.read") || hasPermission("life_countdown.manage"),
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
    href: "/admin/mdresolve",
    title: "MD解析",
    description: "将 Markdown 题库文本解析为结构化题目，并一键导入题库。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("question_bank.read") || hasPermission("question_bank.manage"),
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
    href: "/admin/vocabulary-proficiency",
    title: "单词统计",
    description: "统计词条总量、启用占比、缺失字段与最近更新趋势。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("vocabulary.read") || hasPermission("vocabulary.manage"),
  },
  {
    href: "/admin/schedule",
    title: "日程管理",
    description: "按日程维度管理待办事项，支持筛选、状态流转与负责人协作。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("todo.read"),
  },
  {
    href: "/admin/cron",
    title: "脚本管理",
    description: "复用待办能力维护脚本任务清单，支持筛选、状态流转与负责人协作。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("todo.read"),
  },
  {
    href: "/admin/jobqueue",
    title: "队列管理",
    description: "复用待办能力维护队列任务清单，支持筛选、状态流转与负责人协作。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("todo.read"),
  },
  {
    href: "/admin/todos",
    title: "待办管理",
    description: "基于 HeroUI 快速维护待办事项、状态流转与执行节奏。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("todo.read"),
  },
  {
    href: "/admin/group",
    title: "分组管理",
    description: "维护题库分组：检索、重命名、批量解除绑定。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("question_bank.read") || hasPermission("question_bank.manage"),
  },
  {
    href: "/admin/knowledge",
    title: "知识点管理",
    description: "复用分组能力维护知识点：检索、重命名与解除题目关联。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("question_bank.read") || hasPermission("question_bank.manage"),
  },
  {
    href: "/admin/question-bank",
    title: "试题管理",
    description: "维护试题：题目新增、筛选、状态流转与标签管理。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("question_bank.read") || hasPermission("question_bank.manage"),
  },
  {
    href: "/admin/homework",
    title: "家庭作业",
    description: "复用题库能力管理家庭作业题目：新增、筛选、流转与标签。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("question_bank.read") || hasPermission("question_bank.manage"),
  },
  {
    href: "/admin/job",
    title: "作业监控",
    description: "复用题库能力监控作业题目执行情况：筛选、流转与标签维度查看。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("question_bank.read") || hasPermission("question_bank.manage"),
  },
  {
    href: "/admin/history",
    title: "历史答卷",
    description: "复用题库能力承接历史答卷查询与管理入口，支持筛选、流转与标签维度查看。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("question_bank.read") || hasPermission("question_bank.manage"),
  },
  {
    href: "/admin/poetry",
    title: "诗词本",
    description: "维护诗词词条、拼音、释义与示例，支持启停与关键词检索。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("vocabulary.read") || hasPermission("vocabulary.manage"),
  },
  {
    href: "/admin/data-query",
    title: "数据查询",
    description: "复用系统日志能力执行数据检索，支持按动作与用户维度过滤查询。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("menu.read") || hasPermission("menu.manage"),
  },
  {
    href: "/admin/hot-search",
    title: "热搜",
    description: "查看热搜数据、关键词检索，并维护关注主题命中规则。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("question_bank.read") || hasPermission("question_bank.manage"),
  },
  {
    href: "/admin/knowledge-set",
    title: "知识集管理",
    description: "复用文件管理能力维护知识集目录与文件，支持挂载切换、上传、重命名与移动。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("file.read") || hasPermission("file.manage"),
  },
  {
    href: "/admin/filedetector",
    title: "文件识别",
    description: "复用文件管理能力执行文件识别场景的目录浏览与文件维护，支持挂载切换、上传、重命名、移动与下载。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("file.read") || hasPermission("file.manage"),
  },
  {
    href: "/admin/baidu-pan",
    title: "百度网盘",
    description: "复用文件管理能力承接百度网盘目录与文件维护，支持挂载切换、上传、重命名、移动与下载。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("file.read") || hasPermission("file.manage"),
  },
  {
    href: "/admin/diary",
    title: "日记管理",
    description: "按日期、心情与归档状态管理个人日记，支持新增、编辑与详情查看。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("menu.read") || hasPermission("menu.manage"),
  },
  {
    href: "/admin/syslog",
    title: "系统日志",
    description: "查看鉴权与会话类审计日志，支持动作与用户筛选。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("menu.read") || hasPermission("menu.manage"),
  },
  {
    href: "/admin/password",
    title: "密钥管理",
    description: "聚焦模型密钥的查看、轮换与密钥版本留痕。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("model.read") || hasPermission("model.manage"),
  },
  {
    href: "/admin/price-monitor",
    title: "价格监控",
    description: "聚合模型请求量、成功率、Token 消耗与费用趋势。",
    visible: (hasPermission: (code: string) => boolean) => hasPermission("model.read") || hasPermission("model.manage"),
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
