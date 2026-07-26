import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import ChaptersModal from './ChaptersModal.svelte'
import type { ChaptersResult } from '$lib/chapters'

const result: ChaptersResult = {
  file: '/out/movie.mkv',
  editions: [
    { label: 'Edition 1', default: true, ordered: true, playedNs: 390_000_000_000,
      visibleCount: 1, hiddenCount: 1, chapters: [
        { startNs: 0, endNs: 360_000_000_000, title: 'Chapter 01', hidden: false },
        { startNs: 360_000_000_000, endNs: 390_000_000_000, title: '', hidden: true },
      ] },
    { label: 'Edition 2', default: false, ordered: true, playedNs: 420_000_000_000,
      visibleCount: 1, hiddenCount: 0, chapters: [
        { startNs: 0, endNs: 420_000_000_000, title: 'Chapter 01', hidden: false },
      ] },
  ],
}

describe('ChaptersModal', () => {
  it('lists editions with the default one expanded and hides splice atoms by default', () => {
    render(ChaptersModal, { result, onclose: () => {} })
    expect(screen.getByText('Edition 1')).toBeInTheDocument()
    expect(screen.getByText('Edition 2')).toBeInTheDocument()
    // default edition (0) is expanded -> its visible chapter shows, the hidden one does not
    expect(screen.getByText('Chapter 01')).toBeInTheDocument()
    expect(screen.queryByText('(join)')).toBeNull()
  })

  it('reveals hidden splice atoms when the toggle is checked', async () => {
    render(ChaptersModal, { result, onclose: () => {} })
    await fireEvent.click(screen.getByLabelText(/show hidden/i))
    expect(screen.getByText('(join)')).toBeInTheDocument()
  })

  it('shows an empty-state message when there are no editions', () => {
    render(ChaptersModal, { result: { file: '/out/none.mkv', editions: [] }, onclose: () => {} })
    expect(screen.getByText(/no chapters/i)).toBeInTheDocument()
  })

  it('shows an inspect error', () => {
    render(ChaptersModal, { result: { error: 'mkvextract exited 2' }, onclose: () => {} })
    expect(screen.getByText(/mkvextract exited 2/i)).toBeInTheDocument()
  })

  it('calls onclose from the Close button', async () => {
    const onclose = vi.fn()
    render(ChaptersModal, { result, onclose })
    await fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onclose).toHaveBeenCalled()
  })
})
