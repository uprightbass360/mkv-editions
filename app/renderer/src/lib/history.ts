export interface History<T> { past: T[]; future: T[] }

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] }
}

/** Record `current` as a new past entry and clear the redo future. */
export function record<T>(h: History<T>, current: T, cap = 100): History<T> {
  return { past: [...h.past, current].slice(-cap), future: [] }
}

/** Step back: pop the last past into `value`, push `current` onto future. Null at the start. */
export function undo<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  if (h.past.length === 0) return null
  const value = h.past[h.past.length - 1]
  return { history: { past: h.past.slice(0, -1), future: [current, ...h.future] }, value }
}

/** Step forward: shift the first future into `value`, push `current` onto past. Null at the end. */
export function redo<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  if (h.future.length === 0) return null
  const value = h.future[0]
  return { history: { past: [...h.past, current], future: h.future.slice(1) }, value }
}
