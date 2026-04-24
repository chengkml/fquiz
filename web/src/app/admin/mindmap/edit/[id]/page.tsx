"use client";

import { Alert } from "antd";
import { useParams } from "next/navigation";

import { Card } from "@/components/ui-antd";
import { MindMapEditor } from "../../_components/mindmap-editor";

export default function MindMapEditPage() {
  const params = useParams<{ id?: string | string[] }>();
  const rawId = params?.id;
  const mindMapId = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!mindMapId) {
    return (
      <Card>
        <Alert
          type="error"
          showIcon
          message="缺少导图 ID"
          description="当前路由参数不完整，请返回列表后重试。"
        />
      </Card>
    );
  }

  return <MindMapEditor initialId={mindMapId} />;
}
