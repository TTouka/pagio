import { transformPdf } from "@/lib/pdf/transform";
import type { CropValues, EditPayload, PageInstruction, SplitMode } from "@/lib/pdf/types";

export const runtime = "nodejs";

function isSplitMode(value: unknown): value is SplitMode {
  return value === "none" || value === "vertical" || value === "horizontal";
}

function isCropValues(value: unknown): value is CropValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const crop = value as Record<string, unknown>;

  return ["top", "right", "bottom", "left"].every((key) => typeof crop[key] === "number");
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
    typeof instruction.rotate === "number" &&
    isSplitMode(instruction.splitMode) &&
    isCropValues(instruction.crop)
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
    const message =
      error instanceof Error ? error.message : "PDF の編集に失敗しました。";

    return Response.json({ message }, { status: 400 });
  }
}
