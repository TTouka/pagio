"use client";
/* eslint-disable @next/next/no-img-element */

import type { ChangeEvent, DragEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { EditPayload, PageInstruction, SourceRegion } from "@/lib/pdf/types";

type SplitMode = "vertical" | "horizontal";

interface PreviewPage {
  id: string;
  sourceIndex: number;
  pageNumber: number;
  width: number;
  height: number;
  previewUrl: string;
  rotate: number;
  include: boolean;
  sourceRegion: SourceRegion;
  splitSource: {
    groupId: string;
    mode: SplitMode;
    segmentLabel: string;
    originalPage: {
      id: string;
      sourceIndex: number;
      pageNumber: number;
      width: number;
      height: number;
      previewUrl: string;
      rotate: number;
      include: boolean;
    };
  } | null;
}

interface PdfJsPage {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
}

interface PdfJsDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfJsPage>;
  destroy: () => void;
}

interface PdfJsModule {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument: (options: { data: Uint8Array; disableWorker: boolean }) => {
    promise: Promise<PdfJsDocument>;
  };
}

let cachedPdfJs: Promise<PdfJsModule> | null = null;

async function loadPdfJs() {
  if (!cachedPdfJs) {
    cachedPdfJs = import("pdfjs-dist").then((module) => {
      const pdfjs = module as unknown as PdfJsModule;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }

  return cachedPdfJs;
}

function formatPageSize(width: number, height: number) {
  return `${Math.round(width)} x ${Math.round(height)} pt`;
}

function createPageId(pageNumber: number) {
  return `page-${pageNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSplitGroupId(pageNumber: number) {
  return `split-${pageNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createInstruction(page: PreviewPage): PageInstruction {
  return {
    id: page.id,
    sourceIndex: page.sourceIndex,
    pageNumber: page.pageNumber,
    rotate: page.rotate,
    include: page.include,
    sourceRegion: page.sourceRegion,
  };
}

function getSplitRegion(mode: SplitMode, segmentIndex: number): SourceRegion {
  if (mode === "vertical") {
    return segmentIndex === 0 ? "left" : "right";
  }

  return segmentIndex === 0 ? "top" : "bottom";
}

function getBaseRotate(page: PreviewPage) {
  return page.splitSource?.originalPage.rotate ?? 0;
}

function getPageOutputLabel(page: PreviewPage) {
  return `${page.pageNumber}${page.splitSource ? `(${page.splitSource.segmentLabel})` : ""}`;
}

function MaterialIcon({
  path,
  title,
}: {
  path: string;
  title: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{title}</title>
      <path d={path} />
    </svg>
  );
}

export function PdfEditorApp() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PreviewPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const [isUploadDragActive, setIsUploadDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const downloadNameRef = useRef("edited.pdf");
  const lastSelectionRef = useRef<{
    id: string;
    nextInclude: boolean;
  } | null>(null);

  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? null;
  const includedPages = pages.filter((page) => page.include).length;
  const includedOutputLabels = pages.filter((page) => page.include).map(getPageOutputLabel);

  useEffect(() => {
    return () => {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  function updatePage(id: string, updater: (page: PreviewPage) => PreviewPage) {
    setPages((currentPages) =>
      currentPages.map((page) => (page.id === id ? updater(page) : page)),
    );
  }

  function movePage(id: string, direction: -1 | 1) {
    setPages((currentPages) => {
      const index = currentPages.findIndex((page) => page.id === id);

      if (index === -1) {
        return currentPages;
      }

      const targetIndex = index + direction;

      if (targetIndex < 0 || targetIndex >= currentPages.length) {
        return currentPages;
      }

      const updated = [...currentPages];
      const [item] = updated.splice(index, 1);
      updated.splice(targetIndex, 0, item);
      return updated;
    });
  }

  function resetPage(id: string) {
    updatePage(id, (page) => ({
      ...page,
      rotate: getBaseRotate(page),
      include: true,
    }));
  }

  function applyIncludeSelection(id: string, useRange: boolean) {
    const currentPage = pages.find((page) => page.id === id);

    if (!currentPage) {
      return;
    }

    const nextInclude = !currentPage.include;
    const currentIndex = pages.findIndex((page) => page.id === id);
    const lastSelection = lastSelectionRef.current;
    const lastIndex =
      lastSelection ? pages.findIndex((page) => page.id === lastSelection.id) : -1;
    const shouldApplyRange =
      useRange &&
      lastSelection !== null &&
      lastSelection.nextInclude === nextInclude &&
      lastIndex !== -1;

    if (shouldApplyRange) {
      const start = Math.min(lastIndex, currentIndex);
      const end = Math.max(lastIndex, currentIndex);

      setPages((currentPages) =>
        currentPages.map((page, index) =>
          index >= start && index <= end
            ? {
                ...page,
                include: nextInclude,
              }
            : page,
        ),
      );
    } else {
      setPages((currentPages) =>
        currentPages.map((page) =>
          page.id === id
            ? {
                ...page,
                include: nextInclude,
              }
            : page,
        ),
      );
    }

    setSelectedPageId(id);
    lastSelectionRef.current = {
      id,
      nextInclude,
    };
  }

  function splitPage(id: string, mode: SplitMode) {
    const index = pages.findIndex((page) => page.id === id);

    if (index === -1) {
      return;
    }

    const page = pages[index];

    if (page.splitSource) {
      return;
    }

    const groupId = createSplitGroupId(page.pageNumber);
    const segmentLabels = mode === "vertical" ? ["左", "右"] : ["上", "下"];
    const splitPages: PreviewPage[] = segmentLabels.map((segmentLabel, segmentIndex) => ({
      ...page,
      id: createPageId(page.pageNumber),
      sourceRegion: getSplitRegion(mode, segmentIndex),
      splitSource: {
        groupId,
        mode,
        segmentLabel,
        originalPage: {
          id: page.id,
          sourceIndex: page.sourceIndex,
          pageNumber: page.pageNumber,
          width: page.width,
          height: page.height,
          previewUrl: page.previewUrl,
          rotate: page.rotate,
          include: page.include,
        },
      },
    }));

    setPages([...pages.slice(0, index), ...splitPages, ...pages.slice(index + 1)]);
    setSelectedPageId(splitPages[0]?.id ?? null);
  }

  function undoSplit(id: string) {
    const page = pages.find((item) => item.id === id);

    if (!page?.splitSource) {
      return;
    }

    const groupId = page.splitSource.groupId;
    const groupPages = pages.filter((item) => item.splitSource?.groupId === groupId);
    const groupStartIndex = pages.findIndex((item) => item.splitSource?.groupId === groupId);
    const pagesWithoutGroup = pages.filter((item) => item.splitSource?.groupId !== groupId);
    const { originalPage } = page.splitSource;

    if (groupPages.length === 0 || groupStartIndex === -1) {
      return;
    }

    const restoredPage: PreviewPage = {
      id: originalPage.id,
      sourceIndex: originalPage.sourceIndex,
      pageNumber: originalPage.pageNumber,
      width: originalPage.width,
      height: originalPage.height,
      previewUrl: originalPage.previewUrl,
      rotate: originalPage.rotate,
      include: groupPages.some((item) => item.include),
      sourceRegion: "full",
      splitSource: null,
    };

    setPages([
      ...pagesWithoutGroup.slice(0, groupStartIndex),
      restoredPage,
      ...pagesWithoutGroup.slice(groupStartIndex),
    ]);
    setSelectedPageId(restoredPage.id);
  }

  async function processFile(nextFile: File) {
    if (!nextFile.name.toLowerCase().endsWith(".pdf")) {
      setErrorMessage("PDF ファイルを選択してください。");
      return;
    }

    setIsLoadingPdf(true);
    setErrorMessage(null);
    setStatusMessage(null);

    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }

    try {
      const pdfjs = await loadPdfJs();
      const arrayBuffer = await nextFile.arrayBuffer();
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(arrayBuffer),
        disableWorker: false,
      });
      const pdfDocument = await loadingTask.promise;
      const nextPages: PreviewPage[] = [];

      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const previewViewport = page.getViewport({ scale: 0.3 });
        const sizeViewport = page.getViewport({ scale: 1 });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("プレビュー描画用の canvas を初期化できませんでした。");
        }

        canvas.width = Math.ceil(previewViewport.width);
        canvas.height = Math.ceil(previewViewport.height);

        await page.render({
          canvasContext: context,
          viewport: previewViewport,
        }).promise;

        nextPages.push({
          id: createPageId(pageNumber),
          sourceIndex: pageNumber - 1,
          pageNumber,
          width: sizeViewport.width,
          height: sizeViewport.height,
          previewUrl: canvas.toDataURL("image/png"),
          rotate: 0,
          include: true,
          sourceRegion: "full",
          splitSource: null,
        });
      }

      pdfDocument.destroy();

      setFile(nextFile);
      setPages(nextPages);
      setSelectedPageId(nextPages[0]?.id ?? null);
      lastSelectionRef.current = null;
      setStatusMessage(`${nextFile.name} を読み込みました。`);
      downloadNameRef.current = `${nextFile.name.replace(/\.pdf$/i, "") || "edited"}-edited.pdf`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "PDF の読み込みに失敗しました。";
      setErrorMessage(message);
      setFile(null);
      setPages([]);
      setSelectedPageId(null);
    } finally {
      setIsLoadingPdf(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;

    if (!nextFile) {
      return;
    }

    await processFile(nextFile);
  }

  async function handleExport() {
    if (!file || pages.length === 0) {
      setErrorMessage("先に PDF を読み込んでください。");
      return;
    }

    if (!pages.some((page) => page.include)) {
      setErrorMessage("出力対象のページを 1 つ以上選択してください。");
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setStatusMessage(null);

    const payload: EditPayload = {
      pages: pages.map(createInstruction),
    };

    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("operations", JSON.stringify(payload));

      const response = await fetch("/api/edit-pdf", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "PDF の生成に失敗しました。");
      }

      const blob = await response.blob();
      const nextDownloadUrl = URL.createObjectURL(blob);

      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }

      setDownloadUrl(nextDownloadUrl);
      setStatusMessage("編集済み PDF を生成しました。");

      const anchor = document.createElement("a");
      anchor.href = nextDownloadUrl;
      anchor.download = downloadNameRef.current;
      anchor.click();
    } catch (error) {
      const message = error instanceof Error ? error.message : "PDF の生成に失敗しました。";
      setErrorMessage(message);
    } finally {
      setIsProcessing(false);
    }
  }

  function handleDragStart(event: DragEvent<HTMLElement>, pageId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", pageId);
    setDraggingId(pageId);
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain");

    if (!sourceId || sourceId === targetId) {
      setDraggingId(null);
      setDragTargetId(null);
      return;
    }

    setPages((currentPages) => {
      const sourceIndex = currentPages.findIndex((page) => page.id === sourceId);
      const targetIndex = currentPages.findIndex((page) => page.id === targetId);

      if (sourceIndex === -1 || targetIndex === -1) {
        return currentPages;
      }

      const updated = [...currentPages];
      const [item] = updated.splice(sourceIndex, 1);
      updated.splice(targetIndex, 0, item);
      return updated;
    });

    setDraggingId(null);
    setDragTargetId(null);
  }

  async function handleUploadDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsUploadDragActive(false);

    const nextFile = event.dataTransfer.files?.[0];

    if (!nextFile) {
      return;
    }

    await processFile(nextFile);
  }

  function renderPageCard(page: PreviewPage, index: number) {
    const isSelected = page.id === selectedPageId;
    const splitMaskClassName =
      page.sourceRegion === "left"
        ? "split-mask right"
        : page.sourceRegion === "right"
          ? "split-mask left"
          : page.sourceRegion === "top"
            ? "split-mask bottom"
            : page.sourceRegion === "bottom"
              ? "split-mask top"
              : null;

    return (
      <article
        key={page.id}
        className={[
          "page-card",
          isSelected ? "selected" : "",
          draggingId === page.id ? "dragging" : "",
          dragTargetId === page.id ? "drag-target" : "",
          page.include ? "" : "excluded",
        ]
          .filter(Boolean)
          .join(" ")}
        draggable
        onClick={() => setSelectedPageId(page.id)}
        onDragStart={(event) => handleDragStart(event, page.id)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragTargetId(page.id);
        }}
        onDragLeave={() => {
          if (dragTargetId === page.id) {
            setDragTargetId(null);
          }
        }}
        onDragEnd={() => {
          setDraggingId(null);
          setDragTargetId(null);
        }}
        onDrop={(event) => handleDrop(event, page.id)}
      >
        <div className="page-header">
          <div>
            <h3>出力 {index + 1}</h3>
            <p className="muted small">
              元 {page.pageNumber}
              {page.splitSource ? ` / ${page.splitSource.segmentLabel}` : ""}
            </p>
          </div>
        </div>

        <div
          className="preview-frame"
          onClick={(event) => {
            event.stopPropagation();
            applyIncludeSelection(page.id, event.shiftKey);
          }}
        >
          <img src={page.previewUrl} alt={`PDF ${page.pageNumber} ページのプレビュー`} />
          {splitMaskClassName ? <div className={splitMaskClassName} /> : null}
          {page.splitSource ? <div className="split-chip">{page.splitSource.segmentLabel}側</div> : null}
          <input
            className="thumbnail-checkbox"
            type="checkbox"
            aria-label={`${getPageOutputLabel(page)} を出力対象にする`}
            checked={page.include}
            readOnly
            onClick={(event) => {
              event.stopPropagation();
              applyIncludeSelection(page.id, event.shiftKey);
            }}
          />
          <span className="page-size-text">{formatPageSize(page.width, page.height)}</span>
        </div>

        <div className="page-actions">
          <div className="icon-actions">
            <button
              type="button"
              className="button secondary icon-button"
              aria-label="左回転"
              title="左回転"
              onClick={(event) => {
                event.stopPropagation();
                updatePage(page.id, (currentPage) => ({
                  ...currentPage,
                  rotate: (currentPage.rotate + 270) % 360,
                }));
              }}
            >
              <MaterialIcon path="M12 5V2L8 6l4 4V7c3.31 0 6 2.69 6 6a6 6 0 0 1-6 6 6 6 0 0 1-5.65-4H4.26A8 8 0 0 0 12 21a8 8 0 0 0 0-16Z" title="左回転" />
            </button>
            <button
              type="button"
              className="button secondary icon-button"
              aria-label="右回転"
              title="右回転"
              onClick={(event) => {
                event.stopPropagation();
                updatePage(page.id, (currentPage) => ({
                  ...currentPage,
                  rotate: (currentPage.rotate + 90) % 360,
                }));
              }}
            >
              <MaterialIcon path="M12 5V2l4 4-4 4V7a6 6 0 1 0 5.65 4h2.09A8 8 0 1 1 12 5Z" title="右回転" />
            </button>
            <button
              type="button"
              className="button ghost icon-button"
              aria-label="前へ移動"
              title="前へ移動"
              onClick={(event) => {
                event.stopPropagation();
                movePage(page.id, -1);
              }}
              disabled={index === 0}
            >
              <MaterialIcon path="m15 18-6-6 6-6" title="前へ移動" />
            </button>
            <button
              type="button"
              className="button ghost icon-button"
              aria-label="後へ移動"
              title="後へ移動"
              onClick={(event) => {
                event.stopPropagation();
                movePage(page.id, 1);
              }}
              disabled={index === pages.length - 1}
            >
              <MaterialIcon path="m9 18 6-6-6-6" title="後へ移動" />
            </button>
          </div>
        </div>

        <div className="page-actions">
          {page.splitSource ? (
            <button
              type="button"
              className="button secondary"
              onClick={(event) => {
                event.stopPropagation();
                undoSplit(page.id);
              }}
            >
              分割解除
            </button>
          ) : (
            <>
              <button
                type="button"
                className="button secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  splitPage(page.id, "vertical");
                }}
              >
                左右分割
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  splitPage(page.id, "horizontal");
                }}
              >
                上下分割
              </button>
            </>
          )}
        </div>

        <div className="toolbar">
          <span className="badge">回転 {page.rotate}°</span>
          <span className="badge">{page.include ? "含む" : "除外"}</span>
          {page.splitSource ? <span className="badge">分割</span> : null}
          <button
            type="button"
            className="button ghost"
            onClick={(event) => {
              event.stopPropagation();
              resetPage(page.id);
            }}
          >
            戻す
          </button>
        </div>
      </article>
    );
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-heading">
          <span className="eyebrow">PDF Editor</span>
          <h1>PDF 編集</h1>
          <p>回転 / 分割 / 並べ替え / 抽出</p>
        </div>
        <div className="hero-chips">
          <span className="hero-chip">Rotate</span>
          <span className="hero-chip">Split</span>
          <span className="hero-chip">Reorder</span>
          <span className="hero-chip">Export</span>
        </div>
      </section>

      <section className="workspace">
        <div className="panel">
          <div className="panel-inner">
            <div
              className={`upload-box${isUploadDragActive ? " active" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsUploadDragActive(true);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  return;
                }

                setIsUploadDragActive(false);
              }}
              onDrop={handleUploadDrop}
            >
              <h2>PDF</h2>
              <p className="muted small">選択またはドロップ</p>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileChange}
              />
              {isLoadingPdf ? <p className="muted">PDF を解析中です...</p> : null}
            </div>

            <div className="workspace-header" style={{ marginTop: 24 }}>
              <div>
                <h2>ページ</h2>
                <p>
                  {file
                    ? `${file.name} / ${pages.length} 件 / 出力 ${includedPages} 件`
                    : "PDF 未選択"}
                </p>
              </div>
              <div className="toolbar">
                <button
                  type="button"
                  className="button primary"
                  onClick={handleExport}
                  disabled={!file || pages.length === 0 || isProcessing || isLoadingPdf}
                >
                  {isProcessing ? "生成中..." : "選択したページをDL"}
                </button>
                {downloadUrl ? (
                  <a className="button secondary" href={downloadUrl} download={downloadNameRef.current}>
                    もう一度ダウンロード
                  </a>
                ) : null}
              </div>
            </div>

            {pages.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 24 }}>
                <strong>PDF を読み込んでください</strong>
              </div>
            ) : (
              <div className="pages-grid" style={{ marginTop: 24 }}>
                {pages.map(renderPageCard)}
              </div>
            )}
          </div>
        </div>

        <aside className="sidebar stack">
          <section className="panel">
            <div className="panel-inner stack">
              <div>
                <h2>選択</h2>
                <p className="muted small">Shift+クリックで範囲選択</p>
              </div>

              <div className="field-grid">
                <div className="toolbar">
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => {
                      setPages((currentPages) =>
                        currentPages.map((page) => ({
                          ...page,
                          include: true,
                        })),
                      );
                      setStatusMessage("全ページを出力対象にしました。");
                      setErrorMessage(null);
                    }}
                  >
                    全て選択
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => {
                      setPages((currentPages) =>
                        currentPages.map((page) => ({
                          ...page,
                          include: false,
                        })),
                      );
                      setStatusMessage("全ページを出力対象から外しました。");
                      setErrorMessage(null);
                    }}
                  >
                    解除
                  </button>
                </div>
                <div className="status info">
                  出力対象 {includedPages} 件
                  {includedOutputLabels.length > 0 ? ` / ${includedOutputLabels.join(", ")}` : " / 未選択"}
                </div>
              </div>

              {selectedPage ? (
                <div className="status info">
                  選択中: 元 {selectedPage.pageNumber}
                  {selectedPage.splitSource ? ` / ${selectedPage.splitSource.segmentLabel}側` : ""}
                  {" / "}
                  {selectedPage.include ? "含む" : "除外"}
                </div>
              ) : (
                <div className="status info">未選択</div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-inner stack">
              <h2>状態</h2>
              {statusMessage ? <div className="status success">{statusMessage}</div> : null}
              {errorMessage ? <div className="status error">{errorMessage}</div> : null}
              {!statusMessage && !errorMessage ? <div className="status info">待機中</div> : null}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
