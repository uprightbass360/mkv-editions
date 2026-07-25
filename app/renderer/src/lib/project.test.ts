import { describe, it, expect } from 'vitest'
import {
  newProject, addEdition, appendClip, moveClip, removeClip, importPlaylist,
  sharedClipIds, toMkvedproj, fromMkvedproj, hasBuildableEdition, canStartBuild,
  isSlotKept, toggleSlot, keptSummary, missingKeptSlots,
} from './project'

describe('edition ops are immutable and correct', () => {
  it('adds an edition and appends/moves/removes clips without mutating input', () => {
    const p0 = newProject('/x/BDMV')
    const p1 = addEdition(p0, 'Theatrical')
    expect(p0.editions.length).toBe(0)
    const p2 = appendClip(appendClip(appendClip(p1, 0, 'A'), 0, 'B'), 0, 'C')
    expect(p2.editions[0].clips).toEqual(['A', 'B', 'C'])
    expect(moveClip(p2, 0, 2, 0).editions[0].clips).toEqual(['C', 'A', 'B'])
    expect(removeClip(p2, 0, 1).editions[0].clips).toEqual(['A', 'C'])
  })

  it('appends a repeated clip (documented supported case)', () => {
    const p = appendClip(appendClip(addEdition(newProject('/x'), 'E'), 0, 'A'), 0, 'A')
    expect(p.editions[0].clips).toEqual(['A', 'A'])
  })

  it('imports a multi-angle playlist as one edition per angle', () => {
    const pl = { file: '00003.mpls', angles: 2, editions: [
      { name: '00003', clips: ['1', '2'] }, { name: '00003 (Angle 2)', clips: ['1', '11'] },
    ] }
    const p = importPlaylist(newProject('/x'), pl)
    expect(p.editions.map((e) => e.name)).toEqual(['00003', '00003 (Angle 2)'])
  })
})

describe('sharedClipIds', () => {
  it('finds clips used by more than one edition', () => {
    let p = addEdition(addEdition(newProject('/x'), 'A'), 'B')
    p = appendClip(appendClip(p, 0, 'shared'), 0, 'onlyA')
    p = appendClip(p, 1, 'shared')
    expect([...sharedClipIds(p)]).toEqual(['shared'])
  })
})

describe('mkvedproj serialization round-trips', () => {
  it('emits version 1 with tracks:[] and reads it back', () => {
    let p = appendClip(addEdition(newProject('/x/BDMV'), 'Cut'), 0, 'A')
    p = { ...p, title: 'Film', mode: 'xin1', preserve_chapters: true }
    const j = toMkvedproj(p) as any
    expect(j.version).toBe(1)
    expect(j.tracks).toEqual([])
    expect(j.editions).toEqual([{ name: 'Cut', clips: ['A'] }])
    const back = fromMkvedproj(j)
    expect(back.title).toBe('Film')
    expect(back.mode).toBe('xin1')
    expect(back.editions).toEqual(p.editions)
  })

  it('rejects a wrong version', () => {
    expect(() => fromMkvedproj({ version: 2 })).toThrow(/version/)
  })

  it('rejects editions that are not an array', () => {
    expect(() => fromMkvedproj({ version: 1, bdmv: 'x', title: 't', mode: 'flat', editions: 'nope' })).toThrow(/array/)
  })
})

describe('hasBuildableEdition', () => {
  it('is false with no editions or only empty editions', () => {
    expect(hasBuildableEdition(newProject('/x'))).toBe(false)
    expect(hasBuildableEdition(addEdition(newProject('/x'), 'A'))).toBe(false)
  })
  it('is true once an edition has a clip', () => {
    const p = appendClip(addEdition(newProject('/x'), 'A'), 0, '00001')
    expect(hasBuildableEdition(p)).toBe(true)
  })
})

describe('canStartBuild', () => {
  const base = { folder: '/out', buildable: true, running: false, inspected: true, existingCount: 0, overwrite: false }
  it('is true when folder set, buildable, inspected, no collisions, not running', () => {
    expect(canStartBuild(base)).toBe(true)
  })
  it('is false without a folder, when not buildable, while running, or before inspect', () => {
    expect(canStartBuild({ ...base, folder: null })).toBe(false)
    expect(canStartBuild({ ...base, buildable: false })).toBe(false)
    expect(canStartBuild({ ...base, running: true })).toBe(false)
    expect(canStartBuild({ ...base, inspected: false })).toBe(false)
  })
  it('requires overwrite when there are collisions', () => {
    expect(canStartBuild({ ...base, existingCount: 2, overwrite: false })).toBe(false)
    expect(canStartBuild({ ...base, existingCount: 2, overwrite: true })).toBe(true)
  })
})

const ALL = ['audio:eng:ac3:1', 'audio:spa:ac3:1', 'subtitle:eng:pgs:1']
const proj = (tracks: any[] = []) => ({ ...newProject('/x'), tracks })

describe('track selection', () => {
  it('keeps everything by default', () => {
    const p = proj()
    expect(isSlotKept(p, 'audio:spa:ac3:1')).toBe(true)
    expect(keptSummary(p, ALL)).toEqual({ kept: 3, total: 3, all: true })
  })
  it('first uncheck materializes the full list minus that slot', () => {
    const p = toggleSlot(proj(), 'audio:spa:ac3:1', ALL)
    expect(p.tracks).toEqual([
      { slot: 'audio:eng:ac3:1', keep: true },
      { slot: 'audio:spa:ac3:1', keep: false },
      { slot: 'subtitle:eng:pgs:1', keep: true },
    ])
    expect(isSlotKept(p, 'audio:spa:ac3:1')).toBe(false)
    expect(keptSummary(p, ALL)).toEqual({ kept: 2, total: 3, all: false })
  })
  it('re-checking the last excluded collapses back to keep-all', () => {
    let p = toggleSlot(proj(), 'audio:spa:ac3:1', ALL)
    p = toggleSlot(p, 'audio:spa:ac3:1', ALL)
    expect(p.tracks).toEqual([])
    expect(keptSummary(p, ALL).all).toBe(true)
  })
  it('supports excluding everything (valid strip-all state)', () => {
    let p = proj()
    for (const s of ALL) p = toggleSlot(p, s, ALL)
    expect(p.tracks.every((t: any) => !t.keep)).toBe(true)
    expect(keptSummary(p, ALL)).toEqual({ kept: 0, total: 3, all: false })
  })
  it('round-trips tracks through toMkvedproj / fromMkvedproj', () => {
    const p = toggleSlot(proj(), 'audio:spa:ac3:1', ALL)
    const j = toMkvedproj(p) as any
    expect(j.tracks).toEqual(p.tracks)
    expect(fromMkvedproj(j).tracks).toEqual(p.tracks)
  })
  it('toMkvedproj deep-copies tracks so a live $state proxy cannot leak over IPC', () => {
    const p = toggleSlot(proj(), 'audio:spa:ac3:1', ALL)
    const j = toMkvedproj(p) as any
    expect(j.tracks).toEqual(p.tracks)
    expect(j.tracks).not.toBe(p.tracks) // fresh array
    expect(j.tracks[0]).not.toBe(p.tracks[0]) // fresh element objects
    // the whole payload must be structured-cloneable (what Electron IPC does)
    expect(() => structuredClone(j)).not.toThrow()
  })
})

describe('missingKeptSlots', () => {
  const model: any = {
    slots: [
      { id: 'audio:eng:ac3:1', missing_from: [] },
      { id: 'audio:spa:ac3:1', missing_from: ['00002'] },
    ],
  }
  it('is empty under keep-all', () => {
    const p = { ...newProject('/x'), editions: [{ name: 'A', clips: ['00001', '00002'] }] }
    expect(missingKeptSlots(model, p)).toEqual([])
  })
  it('flags a kept slot missing from a project clip', () => {
    let p: any = { ...newProject('/x'), editions: [{ name: 'A', clips: ['00001', '00002'] }] }
    p = toggleSlot(p, 'audio:eng:ac3:1', ['audio:eng:ac3:1', 'audio:spa:ac3:1'])
    expect(missingKeptSlots(model, p)).toEqual([{ slot: 'audio:spa:ac3:1', missing: ['00002'] }])
  })
})
