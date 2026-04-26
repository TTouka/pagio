export type SourceRegion = "full" | "left" | "right" | "top" | "bottom";

export interface PageInstruction {
  id: string;
  sourceIndex: number;
  pageNumber: number;
  rotate: number;
  include: boolean;
  sourceRegion: SourceRegion;
}

export interface EditPayload {
  pages: PageInstruction[];
}
