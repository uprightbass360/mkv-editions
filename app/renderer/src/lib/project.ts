import type { Playlist } from './model'

export interface ProjectEdition { name: string; clips: string[] }
export interface Project {
  bdmv: string; title: string; mode: 'flat' | 'linked' | 'xin1'
  preserve_chapters: boolean; qpfile: boolean; editions: ProjectEdition[]
}

export function newProject(bdmv: string): Project {
  return { bdmv, title: 'movie', mode: 'flat', preserve_chapters: false, qpfile: false, editions: [] }
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
    tracks: [],
  }
}
export function fromMkvedproj(json: any): Project {
  if (json?.version !== 1) throw new Error('unsupported project version ' + json?.version)
  for (const k of ['bdmv', 'title', 'mode', 'editions']) {
    if (!(k in json)) throw new Error('missing ' + k)
  }
  return {
    bdmv: json.bdmv, title: json.title, mode: json.mode,
    preserve_chapters: !!json.preserve_chapters, qpfile: !!json.qpfile,
    editions: json.editions.map((e: any) => ({ name: e.name, clips: [...e.clips] })),
  }
}
