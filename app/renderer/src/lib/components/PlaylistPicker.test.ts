import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import PlaylistPicker from './PlaylistPicker.svelte'
import type { PlaylistRow } from '$lib/model'

const rows: PlaylistRow[] = [
  { file: '00342.mpls', angles: 1, itemCount: 1, uniqueCount: 1, durNs: 9700e9, isDecoy: false },
  { file: '00095.mpls', angles: 1, itemCount: 101, uniqueCount: 2, durNs: 4000e9, isDecoy: true },
]

describe('PlaylistPicker', () => {
  it('filters by search text', async () => {
    render(PlaylistPicker, { rows, onimport: () => {} })
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '342' } })
    expect(screen.queryByText('00342.mpls')).toBeInTheDocument()
    expect(screen.queryByText('00095.mpls')).toBeNull()
  })
  it('calls onimport with the file', async () => {
    const onimport = vi.fn()
    render(PlaylistPicker, { rows, onimport })
    await fireEvent.click(screen.getAllByText(/import/i)[0])
    expect(onimport).toHaveBeenCalledWith('00342.mpls')
  })
  it('shows chapter count, selects on row click, and does not import on row click', async () => {
    const rows = [{ file: '00342.mpls', angles: 1, itemCount: 1, uniqueCount: 1, durNs: 9700e9, isDecoy: false }]
    const onselect = vi.fn()
    const onimport = vi.fn()
    const { getByText } = render(PlaylistPicker, { rows, chapters: { '00342.mpls': 12 }, onselect, onimport })
    expect(getByText(/12 ch/)).toBeTruthy()
    await fireEvent.click(getByText('00342.mpls'))
    expect(onselect).toHaveBeenCalledWith('00342.mpls')
    expect(onimport).not.toHaveBeenCalled()
  })
})
