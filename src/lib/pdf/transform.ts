import { degrees, PDFDocument, PDFPage } from "pdf-lib";
import type { CropValues, EditPayload, PageInstruction } from "@/lib/pdf/types";

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

function clampPercentage(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(45, value));
}

function normalizeCrop(crop: CropValues): CropValues {
  const normalized = {
    top: clampPercentage(crop.top),
    right: clampPercentage(crop.right),
    bottom: clampPercentage(crop.bottom),
    left: clampPercentage(crop.left),
  };

  if (normalized.left + normalized.right >= 95) {
    normalized.right = Math.max(0, 94 - normalized.left);
  }

  if (normalized.top + normalized.bottom >= 95) {
    normalized.bottom = Math.max(0, 94 - normalized.top);
  }

  return normalized;
}

function getCroppedBox(page: PDFPage, crop: CropValues): BoundingBox {
  const width = page.getWidth();
  const height = page.getHeight();
  const safeCrop = normalizeCrop(crop);

  const left = width * (safeCrop.left / 100);
  const right = width * (1 - safeCrop.right / 100);
  const bottom = height * (safeCrop.bottom / 100);
  const top = height * (1 - safeCrop.top / 100);

  return {
    left,
    right,
    bottom,
    top,
  };
}

function splitBox(box: BoundingBox, splitMode: PageInstruction["splitMode"]) {
  if (splitMode === "none") {
    return [box];
  }

  if (splitMode === "vertical") {
    const middle = (box.left + box.right) / 2;

    return [
      { ...box, right: middle },
      { ...box, left: middle },
    ];
  }

  const middle = (box.bottom + box.top) / 2;

  return [
    { ...box, bottom: middle },
    { ...box, top: middle },
  ];
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

export async function transformPdf(
  inputBytes: Uint8Array,
  payload: EditPayload,
) {
  const sourceDocument = await PDFDocument.load(inputBytes);
  const outputDocument = await PDFDocument.create();
  const sourcePages = sourceDocument.getPages();

  for (const instruction of payload.pages) {
    const sourcePage = sourcePages[instruction.sourceIndex];

    if (!sourcePage) {
      throw new Error(`存在しないページ番号が指定されました: ${instruction.pageNumber}`);
    }

    const cropBox = getCroppedBox(sourcePage, instruction.crop);
    const boxes = splitBox(cropBox, instruction.splitMode);

    for (const box of boxes) {
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
  }

  return outputDocument.save();
}

