import { MermaidEditor } from "../_components/mermaid-editor";

type MermaidDiagramEditPageProps = {
  params: Promise<{ id: string }>;
};

export default async function MermaidDiagramEditPage({ params }: MermaidDiagramEditPageProps) {
  const { id } = await params;
  return <MermaidEditor diagramId={id} />;
}
