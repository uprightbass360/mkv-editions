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

/** First direct text content of <name>...</name> in `xml`, or null. */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? m[1] : null
}

/** Bodies of every <name>...</name> in document order (name must not self-nest). */
function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out.push(m[1])
  return out
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Parse an HH:MM:SS(.fraction) chapter timestamp to nanoseconds (0 if unparseable). */
export function tsToNs(t: string): number {
  const m = /(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(t)
  if (!m) return 0
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1e9)
}

/** Parse mkvextract chapter XML into an edition-aware model.
 * Atoms are read as a flat list; nested chapters (never produced by this app,
 * rare in movie files) are not descended into. */
export function parseChaptersXml(xml: string, file: string): ChaptersResult {
  const editions = blocks(xml, 'EditionEntry').map((ed, i): ChapterEdition => {
    const disp = tag(ed, 'EditionDisplay')
    const name = disp && tag(disp, 'EditionString')
    const label = name ? unescapeXml(name) : `Edition ${i + 1}`
    const ordered = tag(ed, 'EditionFlagOrdered')?.trim() === '1'
    const isDefault = tag(ed, 'EditionFlagDefault')?.trim() === '1'
    const chapters = blocks(ed, 'ChapterAtom').map((a): ChapterAtom => {
      const startS = tag(a, 'ChapterTimeStart')
      const endS = tag(a, 'ChapterTimeEnd')
      const cd = tag(a, 'ChapterDisplay')
      const cs = cd && tag(cd, 'ChapterString')
      return {
        startNs: startS ? tsToNs(startS) : 0,
        endNs: endS ? tsToNs(endS) : null,
        title: cs ? unescapeXml(cs) : '',
        hidden: tag(a, 'ChapterFlagHidden')?.trim() === '1',
      }
    })
    const visibleCount = chapters.filter((c) => !c.hidden).length
    const playedNs = ordered
      ? chapters.reduce((n, c) => n + (c.endNs != null ? c.endNs - c.startNs : 0), 0)
      : 0
    return {
      label, default: isDefault, ordered, playedNs,
      visibleCount, hiddenCount: chapters.length - visibleCount, chapters,
    }
  })
  return { file, editions }
}
