"use client";

import { useParams } from "next/navigation";

import { MindMapEditor } from "../../_components/mindmap-editor";

export default function MindMapEditPage() {
  const params = useParams<{ id: string }>();
  return <MindMapEditor initialId={params.id} />;
}
