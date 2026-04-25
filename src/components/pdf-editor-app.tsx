"use client";
/* eslint-disable @next/next/no-img-element */

import type { CSSProperties, ChangeEvent, DragEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { EditPayload, PageInstruction, SplitMode } from "@/lib/pdf/types";

interface PreviewPage {
  id: string;
  sourceIndex: number;
  pageNumber: number;
  width: number;
  height: number;
  previewUrl: string;
  rotate: number;
  splitMode: SplitMode;
  crop: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
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

const emptyCrop = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

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

function createInstruction(page: PreviewPage): PageInstruction {
  return {
    id: page.id,
    sourceIndex: page.sourceIndex,
    pageNumber: page.pageNumber,
    rotate: page.rotate,
    splitMode: page.splitMode,
    crop: page.crop,
  };
}

export function PdfEditorApp() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PreviewPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const downloadNameRef = useRef("edited.pdf");

  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? null;

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
      rotate: 0,
      splitMode: "none",
      crop: emptyCrop,
    }));
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;

    if (!nextFile) {
      return;
    }

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
          splitMode: "none",
          crop: emptyCrop,
        });
      }

      pdfDocument.destroy();

      setFile(nextFile);
      setPages(nextPages);
      setSelectedPageId(nextPages[0]?.id ?? null);
      setStatusMessage(`${nextFile.name} を読み込みました。`);
      downloadNameRef.current = `${nextFile.name.replace(/\.pdf$/i, "") || "edited"}-edited.pdf`;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "PDF の読み込みに失敗しました。";
      setErrorMessage(message);
      setFile(null);
      setPages([]);
      setSelectedPageId(null);
    } finally {
      setIsLoadingPdf(false);
    }
  }

  async function handleExport() {
    if (!file || pages.length === 0) {
      setErrorMessage("先に PDF を読み込んでください。");
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
      const message =
        error instanceof Error ? error.message : "PDF の生成に失敗しました。";
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

  function renderPageCard(page: PreviewPage, index: number) {
    const isSelected = page.id === selectedPageId;

    return (
      <article
        key={page.id}
        className={[
          "page-card",
          isSelected ? "selected" : "",
          draggingId === page.id ? "dragging" : "",
          dragTargetId === page.id ? "drag-target" : "",
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
            <h3>{index + 1} 枚目の出力ページ候補</h3>
            <p className="muted small">元ページ {page.pageNumber}</p>
          </div>
          <span className="badge">{formatPageSize(page.width, page.height)}</span>
        </div>

        <div className="preview-frame">
          <img src={page.previewUrl} alt={`PDF ${page.pageNumber} ページのプレビュー`} />
          <div
            className="crop-overlay"
            style={
              {
                "--crop-top": page.crop.top,
                "--crop-right": page.crop.right,
                "--crop-bottom": page.crop.bottom,
                "--crop-left": page.crop.left,
              } as CSSProperties
            }
          />
        </div>

        <div className="page-actions">
          <button
            type="button"
            className="button secondary"
            onClick={(event) => {
              event.stopPropagation();
              updatePage(page.id, (currentPage) => ({
                ...currentPage,
                rotate: (currentPage.rotate + 270) % 360,
              }));
            }}
          >
            左回転
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={(event) => {
              event.stopPropagation();
              updatePage(page.id, (currentPage) => ({
                ...currentPage,
                rotate: (currentPage.rotate + 90) % 360,
              }));
            }}
          >
            右回転
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={(event) => {
              event.stopPropagation();
              movePage(page.id, -1);
            }}
            disabled={index === 0}
          >
            前へ
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={(event) => {
              event.stopPropagation();
              movePage(page.id, 1);
            }}
            disabled={index === pages.length - 1}
          >
            後へ
          </button>
        </div>

        <div className="field">
          <label htmlFor={`split-mode-${page.id}`}>分割</label>
          <select
            id={`split-mode-${page.id}`}
            value={page.splitMode}
            onChange={(event) =>
              updatePage(page.id, (currentPage) => ({
                ...currentPage,
                splitMode: event.target.value as SplitMode,
              }))
            }
          >
            <option value="none">分割しない</option>
            <option value="vertical">左右に 2 分割</option>
            <option value="horizontal">上下に 2 分割</option>
          </select>
        </div>

        <div className="toolbar">
          <span className="badge">回転 {page.rotate}°</span>
          {page.splitMode !== "none" ? <span className="badge">分割あり</span> : null}
          <button
            type="button"
            className="button ghost"
            onClick={(event) => {
              event.stopPropagation();
              resetPage(page.id);
            }}
          >
            このページを初期化
          </button>
        </div>
      </article>
    );
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">Browser PDF Editor</span>
        <h1>回転、分割、並べ替え、切り出しを一つの画面で処理する PDF 編集アプリ</h1>
        <p>
          PDF をアップロードすると、ページ順の並べ替え、90 度回転、左右または上下への 2
          分割、余白の切り出しをブラウザ上から指示できます。最終的な PDF はサーバー側で再生成し、新しいファイルとしてダウンロードします。
        </p>
        <ul>
          <li>ドラッグアンドドロップまたは前後ボタンでページ順を変更</li>
          <li>A3 横を A4 縦 2 ページにしたい場合は「左右に 2 分割」を選択</li>
          <li>切り出しは元ページ基準で上下左右の割合を指定</li>
        </ul>
      </section>

      <section className="workspace">
        <div className="panel">
          <div className="panel-inner">
            <div className="upload-box">
              <h2>PDF を読み込む</h2>
              <p className="muted">
                まず PDF を 1 つ選択してください。ページのプレビューと編集パネルを生成します。
              </p>
              <input type="file" accept="application/pdf,.pdf" onChange={handleFileChange} />
              {isLoadingPdf ? <p className="muted">PDF を解析中です...</p> : null}
            </div>

            <div className="workspace-header" style={{ marginTop: 24 }}>
              <div>
                <h2>ページ編集</h2>
                <p>
                  {file
                    ? `${file.name} / ${pages.length} ページ`
                    : "PDF 読み込み後にページ一覧が表示されます。"}
                </p>
              </div>
              <div className="toolbar">
                <button
                  type="button"
                  className="button primary"
                  onClick={handleExport}
                  disabled={!file || pages.length === 0 || isProcessing || isLoadingPdf}
                >
                  {isProcessing ? "生成中..." : "新しい PDF を生成"}
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
                <strong>読み込まれた PDF はまだありません。</strong>
                <span>読み込んだ後にページごとの回転、分割、並び順変更、切り出しができます。</span>
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
                <h2>切り出し設定</h2>
                <p>選択中のページに対して上下左右の切り出し率を指定します。</p>
              </div>

              {selectedPage ? (
                <div className="field-grid">
                  <div className="field">
                    <label htmlFor="crop-top">上 {selectedPage.crop.top}%</label>
                    <input
                      id="crop-top"
                      type="range"
                      min="0"
                      max="45"
                      step="1"
                      value={selectedPage.crop.top}
                      onChange={(event) =>
                        updatePage(selectedPage.id, (page) => ({
                          ...page,
                          crop: {
                            ...page.crop,
                            top: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="crop-right">右 {selectedPage.crop.right}%</label>
                    <input
                      id="crop-right"
                      type="range"
                      min="0"
                      max="45"
                      step="1"
                      value={selectedPage.crop.right}
                      onChange={(event) =>
                        updatePage(selectedPage.id, (page) => ({
                          ...page,
                          crop: {
                            ...page.crop,
                            right: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="crop-bottom">下 {selectedPage.crop.bottom}%</label>
                    <input
                      id="crop-bottom"
                      type="range"
                      min="0"
                      max="45"
                      step="1"
                      value={selectedPage.crop.bottom}
                      onChange={(event) =>
                        updatePage(selectedPage.id, (page) => ({
                          ...page,
                          crop: {
                            ...page.crop,
                            bottom: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="crop-left">左 {selectedPage.crop.left}%</label>
                    <input
                      id="crop-left"
                      type="range"
                      min="0"
                      max="45"
                      step="1"
                      value={selectedPage.crop.left}
                      onChange={(event) =>
                        updatePage(selectedPage.id, (page) => ({
                          ...page,
                          crop: {
                            ...page.crop,
                            left: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="toolbar">
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() =>
                        updatePage(selectedPage.id, (page) => ({
                          ...page,
                          crop: emptyCrop,
                        }))
                      }
                    >
                      切り出しをリセット
                    </button>
                  </div>
                </div>
              ) : (
                <p className="muted">ページを選択するとここで切り出しを設定できます。</p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-inner stack">
              <div>
                <h2>出力メモ</h2>
                <p className="muted">
                  分割を指定したページは、PDF 生成時に 2 ページへ展開されます。左右分割は左から右、上下分割は上から下の順で出力されます。
                </p>
              </div>
              {statusMessage ? <div className="status success">{statusMessage}</div> : null}
              {errorMessage ? <div className="status error">{errorMessage}</div> : null}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
