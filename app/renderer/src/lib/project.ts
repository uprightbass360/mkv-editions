import type { Playlist, DiscModel, TrackSel } from './model'

export interface ProjectEdition { name: string; clips: string[] }
export interface Project {
  bdmv: string; title: string; mode: 'flat' | 'linked' | 'xin1'
  preserve_chapters: boolean; qpfile: boolean; editions: ProjectEdition[]
  tracks: TrackSel[]
}

export function newProject(bdmv: string): Project {
  return { bdmv, title: 'movie', mode: 'flat', preserve_chapters: false, qpfile: false, editions: [], tracks: [] }
}

function mapEdition(p: Project, i: number, fn: (e: ProjectEdition) => ProjectEdition): Project {
  return { ...p, editions: p.editions.map((e, k) => (k === i ? fn(e) : e)) }
}

export function addEdition(p: Project, name: string): Project {
  return { ...p, editions: [...p.editions, { name, clips: [] }] }
}
export function renameEdition(p: Project, i: number, name: string): Project {
  return mapEdition(p, i, (e) => ({ ...e, name }))
}
export function removeEdition(p: Project, i: number): Project {
  return { ...p, editions: p.editions.filter((_, k) => k !== i) }
}
export function appendClip(p: Project, i: number, clipId: string): Project {
  return mapEdition(p, i, (e) => ({ ...e, clips: [...e.clips, clipId] }))
}
export function removeClip(p: Project, i: number, clipIdx: number): Project {
  return mapEdition(p, i, (e) => ({ ...e, clips: e.clips.filter((_, k) => k !== clipIdx) }))
}
export function moveClip(p: Project, i: number, from: number, to: number): Project {
  return mapEdition(p, i, (e) => {
    const clips = [...e.clips]
    const [x] = clips.splice(from, 1)
    clips.splice(to, 0, x)
    return { ...e, clips }
  })
}
export function importPlaylist(p: Project, pl: Playlist): Project {
  const added = pl.editions.map((e) => ({ name: e.name, clips: [...e.clips] }))
  return { ...p, editions: [...p.editions, ...added] }
}

export function sharedClipIds(p: Project): Set<string> {
  const per = new Map<string, Set<number>>()
  p.editions.forEach((e, i) => {
    for (const c of e.clips) {
      if (!per.has(c)) per.set(c, new Set())
      per.get(c)!.add(i)
    }
  })
  return new Set([...per].filter(([, s]) => s.size > 1).map(([c]) => c))
}

export function toMkvedproj(p: Project): object {
  return {
    version: 1, bdmv: p.bdmv, title: p.title, mode: p.mode,
    preserve_chapters: p.preserve_chapters, qpfile: p.qpfile,
    editions: p.editions.map((e) => ({ name: e.name, clips: [...e.clips] })),
    // Deep-copy to plain objects: p.tracks is a live Svelte $state proxy at
    // runtime, and a proxy cannot be structured-cloned over Electron IPC
    // ("An object could not be cloned").
    tracks: p.tracks.map((t) => ({ ...t })),
  }
}
export function hasBuildableEdition(p: Project): boolean {
  return p.editions.some((e) => e.clips.length > 0)
}

export function canStartBuild(s: {
  folder: string | null
  buildable: boolean
  running: boolean
  inspected: boolean
  existingCount: number
  overwrite: boolean
}): boolean {
  return !!s.folder && s.buildable && !s.running && s.inspected &&
    (s.existingCount === 0 || s.overwrite)
}

export function fromMkvedproj(json: any): Project {
  if (json?.version !== 1) throw new Error('unsupported project version ' + json?.version)
  for (const k of ['bdmv', 'title', 'mode', 'editions']) {
    if (!(k in json)) throw new Error('missing ' + k)
  }
  if (!Array.isArray(json.editions)) throw new Error('editions must be an array')
  return {
    bdmv: json.bdmv, title: json.title, mode: json.mode,
    preserve_chapters: !!json.preserve_chapters, qpfile: !!json.qpfile,
    editions: json.editions.map((e: any) => ({ name: e.name, clips: [...e.clips] })),
    tracks: Array.isArray(json.tracks) ? json.tracks : [],
  }
}

export function isSlotKept(p: Project, slot: string): boolean {
  if (p.tracks.length === 0) return true
  const t = p.tracks.find((x) => x.slot === slot)
  return t ? t.keep : true
}

export function toggleSlot(p: Project, slot: string, allSlotIds: string[]): Project {
  let tracks: TrackSel[]
  if (p.tracks.length === 0) {
    tracks = allSlotIds.map((s) => ({ slot: s, keep: s !== slot }))
  } else {
    tracks = p.tracks.map((t) => (t.slot === slot ? { ...t, keep: !t.keep } : t))
  }
  if (tracks.length > 0 && tracks.every((t) => t.keep)) tracks = []
  return { ...p, tracks }
}

export function keptSummary(p: Project, allSlotIds: string[]): { kept: number; total: number; all: boolean } {
  const total = allSlotIds.length
  if (p.tracks.length === 0) return { kept: total, total, all: true }
  const kept = allSlotIds.filter((s) => isSlotKept(p, s)).length
  return { kept, total, all: false }
}

export function missingKeptSlots(m: DiscModel, p: Project): { slot: string; missing: string[] }[] {
  if (p.tracks.length === 0) return []
  const used = new Set<string>()
  for (const e of p.editions) for (const c of e.clips) used.add(c)
  const out: { slot: string; missing: string[] }[] = []
  for (const sl of m.slots) {
    if (!isSlotKept(p, sl.id)) continue
    const missing = sl.missing_from.filter((c) => used.has(c))
    if (missing.length) out.push({ slot: sl.id, missing })
  }
  return out
}
