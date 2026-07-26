// Mirrors the main-process chapters model returned over IPC (the renderer
// cannot import from app/electron).
export interface ChapterAtom { startNs: number; endNs: number | null; title: string; hidden: boolean }
export interface ChapterEdition {
  label: string
  default: boolean
  ordered: boolean
  playedNs: number
  visibleCount: number
  hiddenCount: number
  chapters: ChapterAtom[]
}
export interface ChaptersResult { file: string; editions: ChapterEdition[] }
export type InspectChaptersResult = ChaptersResult | { error: string }

export function isChaptersError(r: InspectChaptersResult): r is { error: string } {
  return (r as { error?: string }).error !== undefined
}
