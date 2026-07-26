import { describe, it, expect } from 'vitest'
import { parseChaptersXml, tsToNs } from './chapters'

const XIN1 = `<?xml version="1.0"?>
<!-- <!DOCTYPE Chapters SYSTEM "matroskachapters.dtd"> -->
<Chapters>
  <EditionEntry>
    <EditionFlagOrdered>1</EditionFlagOrdered>
    <EditionFlagDefault>1</EditionFlagDefault>
    <ChapterAtom>
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:06:00.000000000</ChapterTimeEnd>
      <ChapterDisplay><ChapterString>Chapter 01</ChapterString></ChapterDisplay>
    </ChapterAtom>
    <ChapterAtom>
      <ChapterTimeStart>00:06:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:06:30.000000000</ChapterTimeEnd>
      <ChapterFlagHidden>1</ChapterFlagHidden>
    </ChapterAtom>
  </EditionEntry>
  <EditionEntry>
    <EditionFlagOrdered>1</EditionFlagOrdered>
    <ChapterAtom>
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:07:00.000000000</ChapterTimeEnd>
      <ChapterDisplay><ChapterString>Ext &amp; more</ChapterString></ChapterDisplay>
    </ChapterAtom>
    <ChapterAtom>
      <ChapterTimeStart>00:07:00.000000000</ChapterTimeStart>
      <ChapterDisplay><ChapterString>No end</ChapterString></ChapterDisplay>
    </ChapterAtom>
  </EditionEntry>
</Chapters>`

const SINGLE = `<?xml version="1.0"?>
<Chapters>
  <EditionEntry>
    <EditionDisplay><EditionString>Theatrical</EditionString></EditionDisplay>
    <ChapterAtom>
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:02:00.000000000</ChapterTimeEnd>
      <ChapterDisplay><ChapterString>Intro</ChapterString></ChapterDisplay>
    </ChapterAtom>
  </EditionEntry>
</Chapters>`

const EMPTY = `<?xml version="1.0"?>\n<Chapters>\n</Chapters>`

describe('tsToNs', () => {
  it('parses HH:MM:SS.fraction to nanoseconds', () => {
    expect(tsToNs('00:00:00.000000000')).toBe(0)
    expect(tsToNs('01:00:00.000000000')).toBe(3600_000_000_000)
    expect(tsToNs('00:06:30.500000000')).toBe(390_500_000_000)
  })
})

describe('parseChaptersXml', () => {
  it('reads editions, flags, names, hidden atoms, and played runtime', () => {
    const r = parseChaptersXml(XIN1, '/x/movie.mkv')
    expect(r.file).toBe('/x/movie.mkv')
    expect(r.editions.length).toBe(2)

    const e0 = r.editions[0]
    expect(e0.label).toBe('Edition 1')       // no EditionDisplay -> positional label
    expect(e0.default).toBe(true)
    expect(e0.ordered).toBe(true)
    expect(e0.chapters.length).toBe(2)
    expect(e0.visibleCount).toBe(1)
    expect(e0.hiddenCount).toBe(1)
    expect(e0.chapters[1].hidden).toBe(true)
    expect(e0.playedNs).toBe(390_000_000_000) // (6:00) + (0:30) = 6:30

    const e1 = r.editions[1]
    expect(e1.default).toBe(false)
    expect(e1.chapters[0].title).toBe('Ext & more')  // entity decoded
    expect(e1.chapters[1].endNs).toBeNull()           // missing end -> null
    expect(e1.playedNs).toBe(420_000_000_000)         // only the atom with an end counts (7:00)
  })

  it('labels a single named edition and keeps one edition', () => {
    const r = parseChaptersXml(SINGLE, '/x/flat.mkv')
    expect(r.editions.length).toBe(1)
    expect(r.editions[0].label).toBe('Theatrical')
    expect(r.editions[0].ordered).toBe(false)
    expect(r.editions[0].playedNs).toBe(0)            // runtime not summed for non-ordered
    expect(r.editions[0].chapters[0].title).toBe('Intro')
  })

  it('returns no editions for a chapterless file', () => {
    expect(parseChaptersXml(EMPTY, '/x/none.mkv').editions).toEqual([])
  })
})
