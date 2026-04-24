"use client";

import { RequirementListView } from "@/app/admin/requirements/_components/requirement-list-view";

export default function GitDesktopPage() {
  return (
    <RequirementListView
      pageTitle="Git 管理"
      pageDescription="当前页面复用需求管理能力，用于维护 Git 相关任务：统一跟踪领取、状态流转与协作进度。"
      listTitle="Git 需求列表"
      listDescription="该列表与“需求管理”页共享同一数据与处理链路，支持按关键词、状态、优先级、指派人筛选。"
      createLink="/admin/requirements/new"
      createButtonLabel="新建 Git 需求"
      detailPathBuilder={(item) => `/admin/requirements/${item.id}`}
      topicName="requirements"
      emptyDescription="暂无符合条件的 Git 需求"
      actionLabels={{
        claim: "领取",
        start: "开始处理",
        complete: "标记完成",
        delete: "删除",
      }}
    />
  );
}
