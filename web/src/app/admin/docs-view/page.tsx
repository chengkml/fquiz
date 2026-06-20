"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  Col,
  Empty,
  Layout,
  Menu,
  Row,
  Spin,
  Typography,
  theme,
} from "antd";
import {
  FolderOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { useCallback, useState } from "react";
import type { MenuProps } from "antd";
import ReactMarkdown from "react-markdown";

import { useAuth } from "@/components/auth-provider";
import { readApiError } from "@/lib/api";
import type {
  Document,
  DocumentChapterTreeItem,
} from "@/types/document";

const { Content, Sider } = Layout;
const { Title, Paragraph } = Typography;

type MenuItem = Required<MenuProps>["items"][number];

export default function DocsViewPage() {
  const { fetchWithAuth } = useAuth();
  const { token } = theme.useToken();
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const { data: treeData, isLoading: treeLoading } = useQuery({
    queryKey: ["/api/v1/documents/chapters/tree"],
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/documents/chapters/tree");
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<DocumentChapterTreeItem[]>;
    },
  });

  const { data: selectedDocument, isLoading: documentLoading } = useQuery({
    queryKey: ["/api/v1/documents", selectedDocumentId],
    queryFn: async () => {
      if (!selectedDocumentId) return null;
      const response = await fetchWithAuth(`/api/v1/documents/${selectedDocumentId}`);
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<Document>;
    },
    enabled: !!selectedDocumentId,
  });

  const convertToMenuItems = (chapters: DocumentChapterTreeItem[]): MenuItem[] => {
    return chapters
      .filter((chapter) => {
        // Only show chapters with published documents or published children
        const hasPublishedDocs = chapter.documents?.some((doc) => doc.status === "published");
        const hasPublishedChildren = chapter.children?.some((child) =>
          child.documents?.some((doc) => doc.status === "published")
        );
        return hasPublishedDocs || hasPublishedChildren;
      })
      .map((chapter) => {
        const hasChildren = chapter.children && chapter.children.length > 0;
        const publishedDocs = chapter.documents?.filter((doc) => doc.status === "published") || [];

        const docItems: MenuItem[] = publishedDocs.map((doc) => ({
          key: `doc-${doc.id}`,
          icon: <FileTextOutlined />,
          label: doc.title,
        }));

        const childItems = hasChildren ? convertToMenuItems(chapter.children) : [];

        return {
          key: `chapter-${chapter.id}`,
          icon: <FolderOutlined />,
          label: chapter.name,
          children: [...docItems, ...childItems],
        };
      });
  };

  const handleMenuClick: MenuProps["onClick"] = (e) => {
    if (e.key.startsWith("doc-")) {
      const docId = parseInt(e.key.replace("doc-", ""), 10);
      setSelectedDocumentId(docId);
    }
  };

  // Auto-select first document on load
  const selectFirstDocument = useCallback(() => {
    if (!treeData || treeData.length === 0) return;

    const findFirstPublishedDoc = (chapters: DocumentChapterTreeItem[]): Document | null => {
      for (const chapter of chapters) {
        const publishedDoc = chapter.documents?.find((doc) => doc.status === "published");
        if (publishedDoc) return publishedDoc;

        if (chapter.children) {
          const childDoc = findFirstPublishedDoc(chapter.children);
          if (childDoc) return childDoc;
        }
      }
      return null;
    };

    const firstDoc = findFirstPublishedDoc(treeData);
    if (firstDoc && !selectedDocumentId) {
      setSelectedDocumentId(firstDoc.id);
    }
  }, [treeData, selectedDocumentId]);

  useState(() => {
    selectFirstDocument();
  });

  return (
    <Layout style={{ minHeight: "calc(100vh - 64px)" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={280}
        style={{
          background: token.colorBgContainer,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div style={{ padding: "16px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Title level={4} style={{ margin: 0 }}>
            {!collapsed && "操作文档"}
          </Title>
        </div>
        {treeLoading ? (
          <div style={{ padding: "24px", textAlign: "center" }}>
            <Spin />
          </div>
        ) : treeData && treeData.length > 0 ? (
          <Menu
            mode="inline"
            items={convertToMenuItems(treeData)}
            onClick={handleMenuClick}
            selectedKeys={selectedDocumentId ? [`doc-${selectedDocumentId}`] : []}
            style={{ borderRight: 0 }}
          />
        ) : (
          <div style={{ padding: "24px" }}>
            <Empty description="暂无文档" />
          </div>
        )}
      </Sider>
      <Layout>
        <Content style={{ padding: "24px", background: token.colorBgContainer }}>
          {documentLoading ? (
            <div style={{ textAlign: "center", padding: "48px" }}>
              <Spin size="large" />
            </div>
          ) : selectedDocument ? (
            <Card>
              <Title level={2}>{selectedDocument.title}</Title>
              <div
                style={{
                  marginTop: "24px",
                  lineHeight: "1.8",
                  fontSize: "15px",
                }}
              >
                <ReactMarkdown
                  components={{
                    h1: ({ children }) => <Title level={2}>{children}</Title>,
                    h2: ({ children }) => <Title level={3}>{children}</Title>,
                    h3: ({ children }) => <Title level={4}>{children}</Title>,
                    h4: ({ children }) => <Title level={5}>{children}</Title>,
                    p: ({ children }) => <Paragraph>{children}</Paragraph>,
                    code: ({ children, className }) => {
                      const isBlock = className?.includes("language-");
                      return isBlock ? (
                        <pre
                          style={{
                            background: token.colorBgLayout,
                            padding: "12px",
                            borderRadius: "4px",
                            overflow: "auto",
                          }}
                        >
                          <code>{children}</code>
                        </pre>
                      ) : (
                        <code
                          style={{
                            background: token.colorBgLayout,
                            padding: "2px 6px",
                            borderRadius: "3px",
                            fontFamily: "monospace",
                          }}
                        >
                          {children}
                        </code>
                      );
                    },
                  }}
                >
                  {selectedDocument.content}
                </ReactMarkdown>
              </div>
            </Card>
          ) : (
            <div style={{ textAlign: "center", padding: "48px" }}>
              <Empty description="请从左侧目录选择要查看的文档" />
            </div>
          )}
        </Content>
      </Layout>
    </Layout>
  );
}
