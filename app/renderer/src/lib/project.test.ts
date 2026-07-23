import { describe, it, expect } from 'vitest'
import {
  newProject, addEdition, appendClip, moveClip, removeClip, importPlaylist,
  sharedClipIds, toMkvedproj, fromMkvedproj,
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
})
