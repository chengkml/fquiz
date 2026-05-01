"use client";

import Link from "next/link";
import {
  AppstoreOutlined,
  AuditOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  GoldOutlined,
  LineChartOutlined,
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
    description: "配置角色并分配菜单可见范围。",
    category: "权限",
    icon: <SafetyCertificateOutlined />,
    visible: (hasPermission) => hasPermission("role.read") || hasPermission("role.manage"),
  },
  {
    href: "/menus",
    title: "菜单管理",
    description: "维护后台导航结构、菜单层级与展示状态。",
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
    href: "/files",
    title: "文件管理",
    description: "统一管理本地/SFTP/S3 文件目录，支持上传、重命名、移动和下载。",
    category: "内容",
    icon: <FolderOpenOutlined />,
    visible: (hasPermission) => hasPermission("file.read") || hasPermission("file.manage"),
  },
  {
    href: "/workers",
    title: "Worker监控",
    description: "查看 Worker 在线状态、并发、活跃队列和每个 Worker 的任务快照。",
    category: "协作",
    icon: <DeploymentUnitOutlined />,
    visible: (hasPermission) => hasPermission("celery.read") || hasPermission("celery.manage"),
  },
  {
    href: "/task-monitor",
    title: "任务监控",
    description: "监控 Celery Worker、队列积压与任务执行状态，快速定位失败与阻塞。",
    category: "协作",
    icon: <AuditOutlined />,
    visible: (hasPermission) => hasPermission("celery.read") || hasPermission("celery.manage"),
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
    href: "/power-lines/atp-viewer",
    title: "ATP查看器",
    description: "将 ATP 文本转换为 JSON，并用 maxGraph 进行电路图查看。",
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
    href: "/elevation",
    title: "高程数据管理",
    description: "维护高程数据集并执行线路杆塔高程回填任务。",
    category: "电力",
    icon: <DatabaseOutlined />,
    visible: (hasPermission) => hasPermission("elevation.read") || hasPermission("elevation.manage"),
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
