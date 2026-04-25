import { degrees, PDFDocument, PDFPage } from "pdf-lib";
import type { EditPayload, PageInstruction, SourceRegion } from "@/lib/pdf/types";

interface BoundingBox {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

function normalizeRotation(rotate: number) {
  const normalized = rotate % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function getSourceBox(page: PDFPage, sourceRegion: SourceRegion): BoundingBox {
  const width = page.getWidth();
  const height = page.getHeight();

  if (sourceRegion === "left") {
    return { left: 0, right: width / 2, bottom: 0, top: height };
  }

  if (sourceRegion === "right") {
    return { left: width / 2, right: width, bottom: 0, top: height };
  }

  if (sourceRegion === "top") {
    return { left: 0, right: width, bottom: height / 2, top: height };
  }

  if (sourceRegion === "bottom") {
    return { left: 0, right: width, bottom: 0, top: height / 2 };
  }

  return { left: 0, right: width, bottom: 0, top: height };
}

function getRotatedPageSize(width: number, height: number, rotate: number) {
  const normalized = normalizeRotation(rotate);

  if (normalized === 90 || normalized === 270) {
    return {
      width: height,
      height: width,
    };
  }

  return { width, height };
}

function getRotationPlacement(width: number, height: number, rotate: number) {
  const normalized = normalizeRotation(rotate);

  if (normalized === 90) {
    return { x: height, y: 0 };
  }

  if (normalized === 180) {
    return { x: width, y: height };
  }

  if (normalized === 270) {
    return { x: 0, y: width };
  }

  return { x: 0, y: 0 };
}

export async function transformPdf(inputBytes: Uint8Array, payload: EditPayload) {
  const sourceDocument = await PDFDocument.load(inputBytes);
  const outputDocument = await PDFDocument.create();
  const sourcePages = sourceDocument.getPages();

  for (const instruction of payload.pages) {
    if (!instruction.include) {
      continue;
    }

    const sourcePage = sourcePages[instruction.sourceIndex];

    if (!sourcePage) {
      throw new Error(`存在しないページ番号が指定されました: ${instruction.pageNumber}`);
    }

    const box = getSourceBox(sourcePage, instruction.sourceRegion);
    const embeddedPage = await outputDocument.embedPage(sourcePage, box);
    const width = box.right - box.left;
    const height = box.top - box.bottom;
    const size = getRotatedPageSize(width, height, instruction.rotate);
    const newPage = outputDocument.addPage([size.width, size.height]);
    const placement = getRotationPlacement(width, height, instruction.rotate);

    newPage.drawPage(embeddedPage, {
      x: placement.x,
      y: placement.y,
      width,
      height,
      rotate: degrees(normalizeRotation(instruction.rotate)),
    });
  }

  return outputDocument.save();
}
