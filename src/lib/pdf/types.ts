export type SplitMode = "none" | "vertical" | "horizontal";

export interface CropValues {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PageInstruction {
  id: string;
  sourceIndex: number;
  pageNumber: number;
  rotate: number;
  splitMode: SplitMode;
  crop: CropValues;
}

export interface EditPayload {
  pages: PageInstruction[];
}

