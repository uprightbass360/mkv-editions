export interface Stream {
  pid: number | null
  kind: 'video' | 'audio' | 'subtitle' | 'other'
  codec: string
  lang: string | null
  channels?: number | null
  slot?: string | null
}

export interface TrackSel { slot: string; keep: boolean; lang?: string; default?: boolean }

export interface ClipTrack {
  tid: number
  type: string
  pid: number | null
}

export interface Clip {
  path: string
  frames: number | null
  fps: [number, number]
  dur_ns: number
  codec: string
  exact: boolean
  marks_ns: number[]
  streams: Stream[]
  tracks: ClipTrack[]
  width: number | null
  height: number | null
}

export interface PlaylistEdition {
  name: string
  clips: string[]
}

export interface Playlist {
  file: string
  angles: number
  editions: PlaylistEdition[]
}

export interface Slot {
  id: string
  kind: string
  lang: string
  codec: string
  ordinal: number
  present_in: string[]
  missing_from: string[]
}

export interface Warning {
  kind: string
  clips: string[]
  message: string
}

export interface Disc { title: string | null; poster_data_url: string | null }

export interface DiscModel {
  bdmv: string
  clips: Record<string, Clip>
  playlists: Playlist[]
  slots: Slot[]
  warnings: Warning[]
  disc: Disc
}

export interface LibraryClip { id: string; durNs: number; codec: string; readable: boolean; audioCount: number; subCount: number }
export interface PlaylistRow { file: string; angles: number; itemCount: number; uniqueCount: number; durNs: number; isDecoy: boolean }

export function libraryClips(m: DiscModel): LibraryClip[] {
  const rows = Object.entries(m.clips).map(([id, c]) => ({
    id, durNs: c.dur_ns, codec: c.codec, readable: c.tracks.length > 0,
    audioCount: c.streams.filter((s) => s.kind === 'audio').length,
    subCount: c.streams.filter((s) => s.kind === 'subtitle').length,
  }))
  rows.sort((a, b) => b.durNs - a.durNs || a.id.localeCompare(b.id))
  return rows
}

export function playlistRows(m: DiscModel): PlaylistRow[] {
  const rows = m.playlists.map((p) => {
    const clips = p.editions[0]?.clips ?? []
    const itemCount = clips.length
    const uniqueCount = new Set(clips).size
    const durNs = clips.reduce((s, c) => s + (m.clips[c]?.dur_ns ?? 0), 0)
    const isDecoy = itemCount >= 10 && uniqueCount > 0 && itemCount / uniqueCount >= 5
    return { file: p.file, angles: p.angles, itemCount, uniqueCount, durNs, isDecoy }
  })
  rows.sort((a, b) => b.durNs - a.durNs || a.file.localeCompare(b.file))
  return rows
}

export function longestRealPlaylist(m: DiscModel): string | null {
  const real = playlistRows(m).filter((r) => !r.isDecoy)
  return real.length ? real[0].file : null
}

export function fmtDuration(ns: number): string {
  const s = Math.round(ns / 1_000_000_000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** Fraction of clips with zero decodable tracks (a symptom of an encrypted image). */
export function unreadableRatio(m: DiscModel): number {
  const ids = Object.keys(m.clips)
  if (ids.length === 0) return 0
  const bad = ids.filter((id) => m.clips[id].tracks.length === 0).length
  return bad / ids.length
}

export function chapterCount(c: Clip): number { return c.marks_ns.length }

export function fmtChannels(n: number | null | undefined): string {
  if (n == null) return ''
  if (n === 2) return '2.0'
  if (n === 6) return '5.1'
  if (n === 8) return '7.1'
  return `${n}ch`
}

export function fmtResolution(w: number | null, h: number | null): string {
  return w == null || h == null ? '' : `${w}x${h}`
}

export function clipStreamSummary(c: Clip): string[] {
  return c.streams
    .filter((s) => s.kind !== 'video')
    .map((s) => {
      const ch = s.kind === 'audio' ? fmtChannels(s.channels) : ''
      return [s.kind, s.codec, s.lang, ch].filter(Boolean).join(' ')
    })
}

export function playlistRuntimeNs(m: DiscModel, pl: Playlist): number {
  const cs = pl.editions[0]?.clips ?? []
  return cs.reduce((s, c) => s + (m.clips[c]?.dur_ns ?? 0), 0)
}

/** The disc's distinct feature cuts as representative playlists, shortest
 * first (cap 6). Empty when there is no clear feature - the caller falls back
 * to longestRealPlaylist. Uses items/clips ratio, a relative length floor,
 * clip-sequence dedup, and a near-runtime merge; no clip-overlap (a branching
 * superset overlaps a real cut, so overlap cannot separate them). */
export function detectCuts(m: DiscModel): Playlist[] {
  const clipsOf = (p: Playlist) => p.editions[0]?.clips ?? []
  // 1. linear candidates: near 1:1 items/clips (drops branching supersets + loops)
  const linear = m.playlists.filter((p) => {
    const cs = clipsOf(p)
    return cs.length > 0 && cs.length / new Set(cs).size <= 1.2
  })
  if (linear.length === 0) return []
  // 2. feature-length: >= 60% of the longest candidate
  const longest = Math.max(...linear.map((p) => playlistRuntimeNs(m, p)))
  const feature = linear.filter((p) => playlistRuntimeNs(m, p) >= 0.6 * longest)
  // 3. dedup identical clip sequences (keep the lowest file id)
  const bySeq = new Map<string, Playlist>()
  for (const p of feature) {
    const key = clipsOf(p).join('>')
    const cur = bySeq.get(key)
    if (!cur || p.file < cur.file) bySeq.set(key, p)
  }
  // 4. merge near-equal runtimes (within 3 min); keep the richer representative
  const NEAR = 3 * 60 * 1_000_000_000
  const richer = (a: Playlist, b: Playlist) =>
    a.angles !== b.angles
      ? a.angles > b.angles
      : playlistRuntimeNs(m, a) !== playlistRuntimeNs(m, b)
        ? playlistRuntimeNs(m, a) > playlistRuntimeNs(m, b)
        : a.file < b.file
  const reps: Playlist[] = []
  for (const p of [...bySeq.values()].sort((a, b) => playlistRuntimeNs(m, b) - playlistRuntimeNs(m, a))) {
    const d = playlistRuntimeNs(m, p)
    const gi = reps.findIndex((r) => Math.abs(playlistRuntimeNs(m, r) - d) <= NEAR)
    if (gi < 0) reps.push(p)
    else if (richer(p, reps[gi])) reps[gi] = p
  }
  // 5. shortest first, cap at 6
  reps.sort((a, b) => playlistRuntimeNs(m, a) - playlistRuntimeNs(m, b))
  return reps.slice(0, 6)
}
