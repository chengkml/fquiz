"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  Drawer,
  Empty,
  Menu,
  Spin,
  Typography,
  Button,
  type CardProps,
} from "antd";
import {
  FolderOutlined,
  FileTextOutlined,
  MenuOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useState, type ComponentType, type RefAttributes } from "react";
import type { MenuProps } from "antd";
import ReactMarkdown from "react-markdown";

import { useAuth } from "@/components/auth-provider";
import { useMobileDetection } from "@/hooks/use-mobile-detection";
import { readApiError } from "@/lib/api";
import type {
  Document,
  DocumentChapterTreeItem,
} from "@/types/document";

const { Title, Paragraph } = Typography;
const AntCard = Card as unknown as ComponentType<CardProps & RefAttributes<HTMLDivElement>>;

type MenuItem = Required<MenuProps>["items"][number];

export default function DocsViewPage() {
  const { user, fetchWithAuth, hasPermission } = useAuth();
  const isMobile = useMobileDetection();
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const canRead = hasPermission("document.read") || true;

  const { data: treeData, isLoading: treeLoading } = useQuery({
    queryKey: ["/api/v1/documents/chapters/tree"],
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/documents/chapters/tree");
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<DocumentChapterTreeItem[]>;
    },
    enabled: !!user && canRead,
  });

  const { data: selectedDocument, isLoading: documentLoading } = useQuery({
    queryKey: ["/api/v1/documents", selectedDocumentId],
    queryFn: async () => {
      if (!selectedDocumentId) return null;
      const response = await fetchWithAuth(`/api/v1/documents/${selectedDocumentId}`);
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<Document>;
    },
    enabled: !!selectedDocumentId && !!user && canRead,
  });

  const convertToMenuItems = useCallback((chapters: DocumentChapterTreeItem[]): MenuItem[] => {
    return chapters
      .filter((chapter) => {
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
  }, []);

  const handleMenuClick: MenuProps["onClick"] = useCallback((e) => {
    if (e.key.startsWith("doc-")) {
      const docId = parseInt(e.key.replace("doc-", ""), 10);
      setSelectedDocumentId(docId);
      setMobileMenuOpen(false);
    }
  }, []);

  const selectFirstDocument = useCallback(() => {
    if (!treeData || treeData.length === 0 || selectedDocumentId) return;

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
    if (firstDoc) {
      setSelectedDocumentId(firstDoc.id);
    }
  }, [treeData, selectedDocumentId]);

  useEffect(() => {
    selectFirstDocument();
  }, [selectFirstDocument]);

  if (!user || !canRead) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <AntCard className="admin-docs-view-page-card" title="操作文档">
          <div className="flex items-center justify-center" style={{ minHeight: 300 }}>
            <Empty description="暂无权限访问" />
          </div>
        </AntCard>
      </div>
    );
  }

  const menuContent = (
    <>
      <div className="admin-docs-view-sider-header">
        {!siderCollapsed && <Title level={4} style={{ margin: 0 }}>操作文档</Title>}
      </div>
      {treeLoading ? (
        <div style={{ padding: "24px", textAlign: "center" }}>
          <Spin />
        </div>
      ) : treeData && treeData.length > 0 ? (
        <div className="admin-docs-view-sider-menu">
          <Menu
            mode="inline"
            items={convertToMenuItems(treeData)}
            onClick={handleMenuClick}
            selectedKeys={selectedDocumentId ? [`doc-${selectedDocumentId}`] : []}
            style={{ borderRight: 0, background: "transparent" }}
            inlineCollapsed={siderCollapsed && !isMobile}
          />
        </div>
      ) : (
        <div style={{ padding: "24px" }}>
          <Empty description="暂无文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      )}
      {!isMobile && (
        <div className="admin-docs-view-sider-footer">
          <Button
            aria-label={siderCollapsed ? "展开菜单" : "收起菜单"}
            icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            type="text"
            onClick={() => setSiderCollapsed((prev) => !prev)}
          />
        </div>
      )}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AntCard
        className="admin-docs-view-page-card"
        title="操作文档"
        extra={
          isMobile ? (
            <Button
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuOpen(true)}
            >
              目录
            </Button>
          ) : null
        }
      >
        <div className="admin-docs-view-layout">
          {!isMobile && (
            <div className={`admin-docs-view-sider${siderCollapsed ? " collapsed" : ""}`}>
              {menuContent}
            </div>
          )}

          <div className="admin-docs-view-content">
            {documentLoading ? (
              <div className="flex items-center justify-center" style={{ minHeight: 300 }}>
                <div className="flex flex-col items-center gap-3">
                  <Spin size="large" />
                  <Typography.Text type="secondary">加载文档中...</Typography.Text>
                </div>
              </div>
            ) : selectedDocument ? (
              <AntCard className="admin-docs-view-document-card">
                <Title level={2}>{selectedDocument.title}</Title>
                <div className="admin-docs-view-markdown-content">
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
                          <pre><code>{children}</code></pre>
                        ) : (
                          <code>{children}</code>
                        );
                      },
                    }}
                  >
                    {selectedDocument.content}
                  </ReactMarkdown>
                </div>
              </AntCard>
            ) : (
              <div className="flex items-center justify-center" style={{ minHeight: 300 }}>
                <Empty
                  description="请从左侧目录选择要查看的文档"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              </div>
            )}
          </div>
        </div>
      </AntCard>

      <Drawer
        title="文档目录"
        placement="left"
        open={isMobile && mobileMenuOpen}
        width={280}
        onClose={() => setMobileMenuOpen(false)}
      >
        <Menu
          mode="inline"
          items={convertToMenuItems(treeData || [])}
          onClick={handleMenuClick}
          selectedKeys={selectedDocumentId ? [`doc-${selectedDocumentId}`] : []}
          style={{ borderRight: 0 }}
        />
      </Drawer>
    </div>
  );
}
