"use client";

import { RequirementListView } from "./_components/requirement-list-view";

export default function RequirementsPage() {
  return (
    <RequirementListView
      pageTitle="需求管理"
      pageDescription="统一管理需求任务，支持筛选、领取、状态流转与删除。"
      listTitle="需求列表"
      listDescription="按关键词、状态、优先级、指派人筛选当前需求，并支持一键重置筛选。"
      createLink="/admin/requirements/new"
      createButtonLabel="新建需求"
      detailPathBuilder={(item) => `/admin/requirements/${item.id}`}
      topicName="requirements"
      emptyDescription="暂无符合条件的需求"
      actionLabels={{
        claim: "领取",
        start: "开始处理",
        complete: "标记完成",
        delete: "删除",
      }}
    />
  );
}
