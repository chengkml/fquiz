"use client";

import Link from "next/link";
import {
  AppstoreOutlined,
  AuditOutlined,
  CodeOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  GoldOutlined,
  LineChartOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Avatar, Card, Col, Empty, Row, Segmented, Space, Statistic, Tag, Typography, type CardProps } from "antd";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth-provider";

const AntCard = Card as unknown as ComponentType<CardProps> & {
  Meta: typeof Card.Meta;
};

type DashboardCard = {
  href: string;
  title: string;
  description: string;
  category: string;
  icon: ReactNode;
  visible: (hasPermission: (code: string) => boolean) => boolean;
};

const CATEGORY_COLORS: Record<string, string> = {
  权限: "blue",
  系统: "geekblue",
  内容: "cyan",
  协作: "purple",
  电力: "gold",
  研发: "magenta",
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
    href: "/files",
    title: "文件管理",
    description: "统一管理本地/SFTP/S3 文件目录，支持上传、重命名、移动和下载。",
    category: "内容",
    icon: <FolderOpenOutlined />,
    visible: (hasPermission) => hasPermission("file.read") || hasPermission("file.manage"),
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
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const visibleCards = useMemo(() => CARDS.filter((item) => item.visible(hasPermission)), [hasPermission]);

  const categoryStats = useMemo(() => {
    const stats = new Map<string, number>();
    for (const item of visibleCards) {
      stats.set(item.category, (stats.get(item.category) ?? 0) + 1);
    }
    return stats;
  }, [visibleCards]);

  useEffect(() => {
    if (activeCategory !== "all" && !categoryStats.has(activeCategory)) {
      setActiveCategory("all");
    }
  }, [activeCategory, categoryStats]);

  const categoryOptions = useMemo(
    () => [
      { label: `全部 (${visibleCards.length})`, value: "all" },
      ...Array.from(categoryStats.entries()).map(([category, count]) => ({
        label: `${category} (${count})`,
        value: category,
      })),
    ],
    [categoryStats, visibleCards.length],
  );

  const filteredCards = useMemo(() => {
    if (activeCategory === "all") {
      return visibleCards;
    }
    return visibleCards.filter((item) => item.category === activeCategory);
  }, [activeCategory, visibleCards]);

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
        <Col xs={24} sm={12} lg={6}>
          <AntCard size="small">
            <Statistic title="可访问模块" value={visibleCards.length} suffix="个" />
          </AntCard>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <AntCard size="small">
            <Statistic title="业务分组" value={categoryStats.size} suffix="类" />
          </AntCard>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <AntCard size="small">
            <Statistic title="筛选结果" value={filteredCards.length} suffix="个" />
          </AntCard>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <AntCard size="small">
            <Statistic title="当前角色" value={user?.role_codes.length ?? 0} suffix="个" />
          </AntCard>
        </Col>
      </Row>

      <div>
        <Space direction="vertical" size={12} style={{ width: "100%", marginBottom: 16 }}>
          <Space align="baseline">
            <Typography.Title level={4} style={{ margin: 0 }}>
              模块导航
            </Typography.Title>
            <Typography.Text type="secondary">按权限和业务分组快速定位后台模块。</Typography.Text>
          </Space>
          <Segmented
            block
            options={categoryOptions}
            value={activeCategory}
            onChange={(value) => setActiveCategory(String(value))}
          />
        </Space>

        <Row gutter={[16, 16]}>
          {filteredCards.map((item) => (
            <Col key={item.href} xs={24} sm={12} xl={8} xxl={6}>
              <Link href={item.href} style={{ display: "block", height: "100%" }}>
                <AntCard
                  hoverable
                  size="small"
                  style={{ height: "100%" }}
                  styles={{ body: { height: "100%" } }}
                >
                  <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    <AntCard.Meta
                      avatar={
                        <Avatar
                          icon={item.icon}
                          shape="square"
                          style={{ backgroundColor: "var(--ant-color-primary)" }}
                        />
                      }
                      title={item.title}
                      description={
                        <Typography.Paragraph
                          ellipsis={{ rows: 2, tooltip: item.description }}
                          style={{ marginBottom: 0 }}
                          type="secondary"
                        >
                          {item.description}
                        </Typography.Paragraph>
                      }
                    />
                    <Tag color={CATEGORY_COLORS[item.category] ?? "blue"} style={{ width: "fit-content" }}>
                      {item.category}
                    </Tag>
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
