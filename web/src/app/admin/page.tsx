"use client";

import Link from "next/link";
import {
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,
  CalendarOutlined,
  CloudOutlined,
  CodeOutlined,
  CommentOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  FunctionOutlined,
  GlobalOutlined,
  GoldOutlined,
  LineChartOutlined,
  NodeIndexOutlined,
  ProjectOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Avatar, Card, Col, Empty, Row, Space, Statistic, Tag, Typography, type CardProps } from "antd";
import type { ComponentType, ReactNode } from "react";

import { useAuth } from "@/components/auth-provider";

const AntCard = Card as unknown as ComponentType<CardProps>;

type DashboardCard = {
  href: string;
  title: string;
  description: string;
  category: string;
  icon: ReactNode;
  visible: (hasPermission: (code: string) => boolean) => boolean;
};

const CARDS: DashboardCard[] = [
  {
    href: "/users",
    title: "用户管理",
    description: "查看用户、分配角色、维护账号状态。",
    category: "权限",
    icon: <TeamOutlined />,
    visible: (hasPermission) => hasPermission("user.manage"),
  },
  {
    href: "/roles",
    title: "角色管理",
    description: "配置角色、绑定权限点、分配菜单可见范围。",
    category: "权限",
    icon: <SafetyCertificateOutlined />,
    visible: (hasPermission) => hasPermission("role.read") || hasPermission("role.manage"),
  },
  {
    href: "/menus",
    title: "菜单管理",
    description: "维护后台导航、菜单层级和菜单对应权限。",
    category: "权限",
    icon: <AppstoreOutlined />,
    visible: (hasPermission) => hasPermission("menu.read") || hasPermission("menu.manage"),
  },
  {
    href: "/system-params",
    title: "系统参数",
    description: "维护系统级参数键值、启停状态与变更说明。",
    category: "系统",
    icon: <SettingOutlined />,
    visible: (hasPermission) => hasPermission("system_param.read") || hasPermission("system_param.manage"),
  },
  {
    href: "/chat",
    title: "AI 聊天",
    description: "基于模型路由规则发起多轮对话并保留会话记录。",
    category: "AI",
    icon: <CommentOutlined />,
    visible: (hasPermission) => hasPermission("chat.use"),
  },
  {
    href: "/orchestration",
    title: "编排管理",
    description: "维护编排路由规则，绑定目标模型并控制优先级与启停状态。",
    category: "AI",
    icon: <DeploymentUnitOutlined />,
    visible: (hasPermission) => hasPermission("model.read") || hasPermission("model.manage"),
  },
  {
    href: "/mcp-server",
    title: "MCP管理",
    description: "统一管理 MCP Server 相关编排与启停配置。",
    category: "AI",
    icon: <CloudOutlined />,
    visible: (hasPermission) => hasPermission("model.read") || hasPermission("model.manage"),
  },
  {
    href: "/mermaid-mgr",
    title: "流程图",
    description: "解析流程图文档并导入结构化题目。",
    category: "内容",
    icon: <NodeIndexOutlined />,
    visible: (hasPermission) => hasPermission("question_bank.read") || hasPermission("question_bank.manage"),
  },
  {
    href: "/requirements",
    title: "需求管理",
    description: "查看需求列表、流转处理、评论协作和操作留痕。",
    category: "研发",
    icon: <ProjectOutlined />,
    visible: (hasPermission) => hasPermission("requirement.read"),
  },
  {
    href: "/task-monitor",
    title: "任务监控",
    description: "统一查看需求与待办执行状态，快速定位高优先级和超期风险。",
    category: "协作",
    icon: <AuditOutlined />,
    visible: (hasPermission) => hasPermission("requirement.read") || hasPermission("todo.read"),
  },
  {
    href: "/power-lines",
    title: "线路管理",
    description: "维护输电线路与杆塔参数，支持导入导出和风险字段管理。",
    category: "电力",
    icon: <GoldOutlined />,
    visible: (hasPermission) =>
      hasPermission("line.read") || hasPermission("line.manage") || hasPermission("tower.read") || hasPermission("tower.manage"),
  },
  {
    href: "/lightning-currents",
    title: "雷电幅值统计",
    description: "导入雷电流原始序列并自动提取防雷计算参数。",
    category: "电力",
    icon: <LineChartOutlined />,
    visible: (hasPermission) => hasPermission("lightning.read") || hasPermission("lightning.manage"),
  },
  {
    href: "/lightning-distribution",
    title: "雷电分布统计",
    description: "计算 Ng、空间网格、热力散点和杆塔缓冲区风险。",
    category: "电力",
    icon: <GlobalOutlined />,
    visible: (hasPermission) => hasPermission("lightning.read") || hasPermission("lightning.manage"),
  },
  {
    href: "/mindmap",
    title: "思维导图",
    description: "管理导图 JSON、AI 生成和待办一键初始化。",
    category: "内容",
    icon: <FunctionOutlined />,
    visible: (hasPermission) => hasPermission("question_bank.read") || hasPermission("question_bank.manage"),
  },
  {
    href: "/schedule",
    title: "日程管理",
    description: "按日程维度管理待办事项，支持筛选与状态流转。",
    category: "协作",
    icon: <CalendarOutlined />,
    visible: (hasPermission) => hasPermission("todo.read"),
  },
  {
    href: "/knowledge-set",
    title: "知识集管理",
    description: "维护知识集目录与文件，支持挂载、上传、重命名与移动。",
    category: "内容",
    icon: <FolderOpenOutlined />,
    visible: (hasPermission) => hasPermission("file.read") || hasPermission("file.manage"),
  },
  {
    href: "/syslog",
    title: "系统日志",
    description: "查看鉴权与会话类审计日志，支持动作与用户筛选。",
    category: "系统",
    icon: <FileSearchOutlined />,
    visible: (hasPermission) => hasPermission("menu.read") || hasPermission("menu.manage"),
  },
  {
    href: "/api-tester",
    title: "API测试",
    description: "执行模型冒烟测试与对话测试，查看最近测试记录。",
    category: "研发",
    icon: <ApiOutlined />,
    visible: (hasPermission) => hasPermission("model.read") || hasPermission("model.manage"),
  },
  {
    href: "/models",
    title: "模型管理",
    description: "管理模型编码、状态流转、路由规则、密钥轮换与健康检查。",
    category: "AI",
    icon: <DatabaseOutlined />,
    visible: (hasPermission) => hasPermission("model.read") || hasPermission("model.manage"),
  },
  {
    href: "/wine-runner",
    title: "Wine执行器",
    description: "通过 Wine 执行 Windows EXE，并实时查看测试日志。",
    category: "研发",
    icon: <CodeOutlined />,
    visible: (hasPermission) => hasPermission("wine.read") || hasPermission("wine.manage"),
  },
];

export default function AdminHomePage() {
  const { hasPermission, user } = useAuth();
  const visibleCards = CARDS.filter((item) => item.visible(hasPermission));
  const categoryCount = new Set(visibleCards.map((item) => item.category)).size;

  if (visibleCards.length === 0) {
    return (
      <AntCard>
        <Empty description="当前账号暂无可访问的后台模块。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </AntCard>
    );
  }

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <AntCard>
            <Statistic title="可访问模块" value={visibleCards.length} suffix="个" />
          </AntCard>
        </Col>
        <Col xs={24} md={8}>
          <AntCard>
            <Statistic title="业务分组" value={categoryCount} suffix="类" />
          </AntCard>
        </Col>
        <Col xs={24} md={8}>
          <AntCard>
            <Statistic title="当前角色" value={user?.role_codes.length ?? 0} suffix="个" />
          </AntCard>
        </Col>
      </Row>

      <div>
        <Space align="baseline" style={{ marginBottom: 16 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            模块导航
          </Typography.Title>
          <Typography.Text type="secondary">按权限展示，入口遵循 Ant Design 卡片列表模式。</Typography.Text>
        </Space>

        <Row gutter={[16, 16]}>
          {visibleCards.map((item) => (
            <Col key={item.href} xs={24} sm={12} xl={8} xxl={6}>
              <Link href={item.href} style={{ display: "block", height: "100%" }}>
                <AntCard hoverable style={{ height: "100%" }}>
                  <Space align="start" size={12}>
                    <Avatar
                      icon={item.icon}
                      shape="square"
                      style={{ backgroundColor: "var(--ant-color-primary)" }}
                    />
                    <Space direction="vertical" size={4}>
                      <Space size={8} wrap>
                        <Typography.Text strong>{item.title}</Typography.Text>
                        <Tag color="blue">{item.category}</Tag>
                      </Space>
                      <Typography.Text type="secondary">{item.description}</Typography.Text>
                    </Space>
                  </Space>
                </AntCard>
              </Link>
            </Col>
          ))}
        </Row>
      </div>
    </Space>
  );
}
