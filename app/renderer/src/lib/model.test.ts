import { describe, it, expect } from 'vitest'
import { libraryClips, playlistRows, longestRealPlaylist, fmtDuration, type DiscModel } from './model'
import { unreadableRatio } from './model'
import { chapterCount, fmtChannels, fmtResolution, clipStreamSummary } from './model'

const NS = 1_000_000_000
function clip(dur: number, tracks = 1, aud = 1, sub = 0) {
  return {
    path: '', frames: null, fps: [24, 1] as [number, number], dur_ns: dur * NS,
    codec: 'h264', exact: false, marks_ns: [], width: null, height: null,
    streams: [
      { pid: 1, kind: 'video' as const, codec: 'h264', lang: null },
      ...Array.from({ length: aud }, (_, i) => ({ pid: 10 + i, kind: 'audio' as const, codec: 'ac3', lang: 'eng' })),
      ...Array.from({ length: sub }, (_, i) => ({ pid: 20 + i, kind: 'subtitle' as const, codec: 'pgs', lang: 'eng' })),
    ],
    tracks: Array.from({ length: tracks }, (_, i) => ({ tid: i, type: 'video', pid: i })),
  }
}
const model: DiscModel = {
  bdmv: '/x/BDMV',
  clips: {
    '00368': clip(9600, 1, 2, 2), '00364': clip(108, 1, 2, 2),
    '00099': clip(23, 1, 0, 0), '00098': clip(30, 1, 0, 0), '00666': clip(40, 0),
  },
  playlists: [
    { file: '00342.mpls', angles: 1, editions: [{ name: '00342', clips: ['00368'] }] },
    { file: '00095.mpls', angles: 1, editions: [{ name: '00095', clips: Array.from({ length: 101 }, (_, i) => (i % 2 ? '00098' : '00099')) }] },
    { file: '00666.mpls', angles: 1, editions: [{ name: '00666', clips: ['00666'] }] },
  ],
  slots: [], warnings: [],
  disc: { title: null, poster_data_url: null },
}

describe('libraryClips', () => {
  it('is duration-sorted and flags unreadable clips', () => {
    const lib = libraryClips(model)
    expect(lib.map((c) => c.id)).toEqual(['00368', '00364', '00666', '00098', '00099'])
    expect(lib.find((c) => c.id === '00666')!.readable).toBe(false)
    expect(lib.find((c) => c.id === '00368')!.audioCount).toBe(2)
  })
})

describe('playlistRows', () => {
  it('computes counts, duration and decoy flag', () => {
    const rows = playlistRows(model)
    expect(rows.find((r) => r.file === '00342.mpls')!.isDecoy).toBe(false)
    const decoy = rows.find((r) => r.file === '00095.mpls')!
    expect(decoy.itemCount).toBe(101)
    expect(decoy.uniqueCount).toBe(2)
    expect(decoy.isDecoy).toBe(true)
    expect(rows[0].file).toBe('00342.mpls')
  })
})

describe('longestRealPlaylist', () => {
  it('picks the longest non-decoy playlist', () => {
    expect(longestRealPlaylist(model)).toBe('00342.mpls')
  })
})

describe('fmtDuration', () => {
  it('formats H:MM:SS', () => {
    expect(fmtDuration(9600 * NS)).toBe('2:40:00')
  })
})

describe('unreadableRatio', () => {
  it('is high when most clips have zero tracks', () => {
    const m: any = { clips: {
      a: { tracks: [] }, b: { tracks: [] }, c: { tracks: [{ tid: 0, type: 'video', pid: 1 }] },
    } }
    expect(unreadableRatio(m)).toBeCloseTo(2 / 3)
    expect(unreadableRatio(m) > 0.5).toBe(true)
  })
  it('is 0 for a healthy disc and 0 for no clips', () => {
    expect(unreadableRatio({ clips: { a: { tracks: [{ tid: 0, type: 'video', pid: 1 }] } } } as any)).toBe(0)
    expect(unreadableRatio({ clips: {} } as any)).toBe(0)
  })
})

describe('identification helpers', () => {
  it('fmtChannels maps common layouts', () => {
    expect(fmtChannels(2)).toBe('2.0')
    expect(fmtChannels(6)).toBe('5.1')
    expect(fmtChannels(8)).toBe('7.1')
    expect(fmtChannels(1)).toBe('1ch')
    expect(fmtChannels(null)).toBe('')
  })
  it('fmtResolution formats WxH or empty', () => {
    expect(fmtResolution(1920, 1080)).toBe('1920x1080')
    expect(fmtResolution(null, 1080)).toBe('')
  })
  it('chapterCount and clipStreamSummary read the clip', () => {
    const clip: any = {
      marks_ns: [0, 1, 2], width: 1920, height: 1080,
      streams: [
        { pid: 1, kind: 'video', codec: 'h264', lang: null },
        { pid: 2, kind: 'audio', codec: 'ac3', lang: 'eng', channels: 6 },
        { pid: 3, kind: 'subtitle', codec: 'pgs', lang: 'spa' },
      ],
    }
    expect(chapterCount(clip)).toBe(3)
    expect(clipStreamSummary(clip)).toEqual(['audio ac3 eng 5.1', 'subtitle pgs spa'])
  })
})
