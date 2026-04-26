import { transformPdf } from "@/lib/pdf/transform";
import type { EditPayload, PageInstruction, SourceRegion } from "@/lib/pdf/types";

export const runtime = "nodejs";

function isRightAngleRotation(value: unknown): value is number {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function isSourceRegion(value: unknown): value is SourceRegion {
  return (
    value === "full" ||
    value === "left" ||
    value === "right" ||
    value === "top" ||
    value === "bottom"
  );
}

function isPageInstruction(value: unknown): value is PageInstruction {
  if (!value || typeof value !== "object") {
    return false;
  }

  const instruction = value as Record<string, unknown>;

  return (
    typeof instruction.id === "string" &&
    typeof instruction.sourceIndex === "number" &&
    typeof instruction.pageNumber === "number" &&
    isRightAngleRotation(instruction.rotate) &&
    typeof instruction.include === "boolean" &&
    isSourceRegion(instruction.sourceRegion)
  );
}

function parsePayload(raw: string): EditPayload {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("操作内容の JSON を解釈できませんでした。");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("操作内容の形式が不正です。");
  }

  const payload = parsed as Record<string, unknown>;

  if (!Array.isArray(payload.pages) || payload.pages.length === 0) {
    throw new Error("編集対象のページが指定されていません。");
  }

  if (!payload.pages.every(isPageInstruction)) {
    throw new Error("ページ操作の形式が不正です。");
  }

  return {
    pages: payload.pages as PageInstruction[],
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const operations = formData.get("operations");

    if (!(file instanceof File) || file.size === 0) {
      return Response.json(
        { message: "PDF ファイルをアップロードしてください。" },
        { status: 400 },
      );
    }

    if (typeof operations !== "string") {
      return Response.json(
        { message: "操作内容が送信されていません。" },
        { status: 400 },
      );
    }

    const payload = parsePayload(operations);

    if (!payload.pages.some((page) => page.include)) {
      return Response.json(
        { message: "出力対象のページを 1 つ以上選択してください。" },
        { status: 400 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const output = await transformPdf(bytes, payload);

    return new Response(Buffer.from(output), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="edited.pdf"',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF の編集に失敗しました。";

    return Response.json({ message }, { status: 400 });
  }
}
