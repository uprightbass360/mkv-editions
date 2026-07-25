import { describe, it, expect } from 'vitest'
import { emptyHistory, record, undo, redo } from './history'

describe('history', () => {
  it('record pushes current and clears the redo future', () => {
    expect(record({ past: ['a'], future: ['z'] }, 'b')).toEqual({ past: ['a', 'b'], future: [] })
  })
  it('record honors the cap, dropping oldest', () => {
    let h = emptyHistory<number>()
    for (let i = 0; i < 5; i++) h = record(h, i, 3)
    expect(h.past).toEqual([2, 3, 4])
  })
  it('undo returns the last past and pushes current onto future', () => {
    const r = undo({ past: ['a', 'b'], future: [] }, 'c')!
    expect(r.value).toBe('b')
    expect(r.history).toEqual({ past: ['a'], future: ['c'] })
  })
  it('undo returns null at the start', () => {
    expect(undo(emptyHistory<string>(), 'c')).toBeNull()
  })
  it('redo returns the first future and pushes current onto past', () => {
    const r = redo({ past: ['a'], future: ['c'] }, 'b')!
    expect(r.value).toBe('c')
    expect(r.history).toEqual({ past: ['a', 'b'], future: [] })
  })
  it('redo returns null at the end', () => {
    expect(redo({ past: ['a'], future: [] }, 'b')).toBeNull()
  })
  it('a record after undo drops the redo future', () => {
    let h: any = { past: ['s0', 's1'], future: [] }
    let cur = 's2'
    let r = undo(h, cur)!; h = r.history; cur = r.value // cur=s1, future=[s2]
    h = record(h, cur)
    expect(h.future).toEqual([])
  })
})
