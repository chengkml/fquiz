"use client";

import { RequirementListView } from "@/app/admin/requirements/_components/requirement-list-view";

export default function CodeReviewPage() {
  return (
    <RequirementListView
      pageTitle="代码评审"
      pageDescription="面向代码评审任务的处理看板：统一查看、分派与状态流转。"
      listTitle="代码评审任务"
      listDescription="按关键词、状态、优先级、指派人快速定位待处理的代码评审任务。"
      createLink="/admin/requirements/new"
      createButtonLabel="新建评审任务"
      detailPathBuilder={(item) => `/admin/requirements/${item.id}`}
      topicName="requirements"
      emptyDescription="暂无符合条件的代码评审任务"
      actionLabels={{
        claim: "领取评审",
        start: "开始评审",
        complete: "评审完成",
        delete: "删除任务",
        deleteConfirmTitle: "确认删除该代码评审任务？",
        deleteConfirmDescription: (item) => `删除后不可恢复：${item.code}（${item.title}）`,
      }}
      tableLabels={{
        title: "评审标题",
      }}
    />
  );
}
