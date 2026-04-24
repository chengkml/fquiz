import Link from "next/link";
import type { ColumnsType } from "antd/es/table";
import { Tag, Tooltip, Typography } from "antd";
import type { ReactNode } from "react";

import type {
  RequirementPriority,
  RequirementStatus,
  RequirementSummary,
} from "@/types/auth";

export const REQUIREMENT_STATUS_OPTIONS: RequirementStatus[] = [
  "PENDING_ANALYSIS",
  "PENDING_REVIEW",
  "PENDING_REVISION",
  "OPEN",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
];

export const REQUIREMENT_PRIORITY_OPTIONS: RequirementPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

export const REQUIREMENT_STATUS_LABEL: Record<RequirementStatus, string> = {
  PENDING_ANALYSIS: "待分析",
  PENDING_REVIEW: "待评审",
  PENDING_REVISION: "待修订",
  OPEN: "待处理",
  IN_PROGRESS: "处理中",
  COMPLETED: "已完成",
  CLOSED: "已关闭",
  CANCELLED: "已取消",
};

export const REQUIREMENT_PRIORITY_LABEL: Record<RequirementPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

const REQUIREMENT_STATUS_TAG_COLOR: Record<RequirementStatus, string> = {
  PENDING_ANALYSIS: "default",
  PENDING_REVIEW: "gold",
  PENDING_REVISION: "orange",
  OPEN: "processing",
  IN_PROGRESS: "blue",
  COMPLETED: "success",
  CLOSED: "default",
  CANCELLED: "error",
};

const REQUIREMENT_PRIORITY_TAG_COLOR: Record<RequirementPriority, string> = {
  low: "default",
  medium: "blue",
  high: "orange",
  urgent: "red",
};

export type RequirementListFilters = {
  keyword: string;
  status: string;
  priority: string;
  assignee_user_id: string;
};

export const DEFAULT_REQUIREMENT_LIST_FILTERS: RequirementListFilters = {
  keyword: "",
  status: "",
  priority: "",
  assignee_user_id: "",
};

export const ALL_STATUS_FILTER = "__all_status__";
export const ALL_PRIORITY_FILTER = "__all_priority__";
export const ALL_ASSIGNEE_FILTER = "__all_assignee__";

export type RequirementActionLabels = {
  claim: string;
  start: string;
  complete: string;
  delete: string;
  deleteConfirmTitle: string;
  deleteConfirmDescription: (item: RequirementSummary) => string;
};

export type RequirementTableLabels = {
  code: string;
  title: string;
  status: string;
  priority: string;
  project: string;
  assignee: string;
  updatedAt: string;
  actions: string;
};

export type RequirementRowAction = {
  key: "claim" | "start" | "complete" | "delete";
  label: string;
  loading: boolean;
  disabled: boolean;
  danger?: boolean;
  onClick: () => void;
};

export type BuildRequirementRowActionsOptions = {
  item: RequirementSummary;
  canProcess: boolean;
  actionLabels: RequirementActionLabels;
  claimLoading: boolean;
  transitionLoading: boolean;
  deleteLoading: boolean;
  disabled: boolean;
  onClaim: (requirementId: string) => void;
  onTransition: (requirementId: string, status: RequirementStatus) => void;
  onDelete: (requirementId: string) => void;
};

export function buildRequirementQueryString(filters: RequirementListFilters): string {
  const params = new URLSearchParams();
  if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.assignee_user_id) params.set("assignee_user_id", filters.assignee_user_id);
  return params.toString();
}

export function buildRequirementRowActions(
  options: BuildRequirementRowActionsOptions,
): RequirementRowAction[] {
  const {
    item,
    canProcess,
    actionLabels,
    claimLoading,
    transitionLoading,
    deleteLoading,
    disabled,
    onClaim,
    onTransition,
    onDelete,
  } = options;

  if (!canProcess) {
    return [];
  }

  const actions: RequirementRowAction[] = [
    {
      key: "claim",
      label: actionLabels.claim,
      loading: claimLoading,
      disabled,
      onClick: () => onClaim(item.id),
    },
  ];

  if (item.status === "OPEN") {
    actions.push({
      key: "start",
      label: actionLabels.start,
      loading: transitionLoading,
      disabled,
      onClick: () => onTransition(item.id, "IN_PROGRESS"),
    });
  }

  if (item.status === "IN_PROGRESS") {
    actions.push({
      key: "complete",
      label: actionLabels.complete,
      loading: transitionLoading,
      disabled,
      onClick: () => onTransition(item.id, "COMPLETED"),
    });
  }

  actions.push({
    key: "delete",
    label: actionLabels.delete,
    loading: deleteLoading,
    disabled,
    danger: true,
    onClick: () => onDelete(item.id),
  });

  return actions;
}

export type BuildRequirementTableColumnsOptions = {
  detailPathBuilder: (item: RequirementSummary) => string;
  labels: RequirementTableLabels;
  renderActions: (item: RequirementSummary) => ReactNode;
};

export function buildRequirementTableColumns(
  options: BuildRequirementTableColumnsOptions,
): ColumnsType<RequirementSummary> {
  const { detailPathBuilder, labels, renderActions } = options;

  return [
    {
      title: labels.code,
      dataIndex: "code",
      key: "code",
      width: 180,
      fixed: "left",
      render: (code: string) => (
        <Typography.Text code>{code || "-"}</Typography.Text>
      ),
    },
    {
      title: labels.title,
      dataIndex: "title",
      key: "title",
      width: 360,
      render: (_: string, item) => (
        <div className="min-w-0">
          <Tooltip title={item.title}>
            <Link
              href={detailPathBuilder(item)}
              className="font-medium text-[var(--ant-color-primary)] hover:underline"
            >
              {item.title}
            </Link>
          </Tooltip>
          <Typography.Paragraph
            className="mb-0 mt-1"
            type="secondary"
            ellipsis={{ rows: 2, tooltip: item.description || "-" }}
          >
            {item.description || "-"}
          </Typography.Paragraph>
        </div>
      ),
    },
    {
      title: labels.status,
      dataIndex: "status",
      key: "status",
      width: 140,
      render: (status: RequirementStatus) => (
        <Tag color={REQUIREMENT_STATUS_TAG_COLOR[status] ?? "default"}>
          {REQUIREMENT_STATUS_LABEL[status] ?? status}
        </Tag>
      ),
    },
    {
      title: labels.priority,
      dataIndex: "priority",
      key: "priority",
      width: 120,
      render: (priority: RequirementPriority) => (
        <Tag color={REQUIREMENT_PRIORITY_TAG_COLOR[priority] ?? "default"}>
          {REQUIREMENT_PRIORITY_LABEL[priority] ?? priority}
        </Tag>
      ),
    },
    {
      title: labels.project,
      dataIndex: "project_name",
      key: "project_name",
      width: 140,
      render: (projectName: string | null) => projectName || "-",
    },
    {
      title: labels.assignee,
      key: "assignee",
      dataIndex: ["assignee", "username"],
      width: 140,
      render: (_: string, item) => item.assignee?.username || "-",
    },
    {
      title: labels.updatedAt,
      dataIndex: "updated_at",
      key: "updated_at",
      width: 180,
      render: (updatedAt: string) => (
        <Typography.Text type="secondary">
          {updatedAt ? new Date(updatedAt).toLocaleString() : "-"}
        </Typography.Text>
      ),
    },
    {
      title: labels.actions,
      key: "actions",
      fixed: "right",
      width: 220,
      render: (_: string, item) => renderActions(item),
    },
  ];
}
