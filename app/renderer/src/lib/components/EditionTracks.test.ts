import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import EditionTracks from './EditionTracks.svelte'
import { newProject, addEdition, appendClip, sharedClipIds } from '$lib/project'

describe('EditionTracks', () => {
  it('renders editions with their clips and calls onappend on drop', async () => {
    const p = appendClip(addEdition(newProject('/x'), 'Theatrical'), 0, '00368')
    const onappend = vi.fn()
    render(EditionTracks, { project: p, shared: sharedClipIds(p), onappend, onremove: () => {}, onrename: () => {}, onadd: () => {} })
    expect(screen.getByText('00368')).toBeInTheDocument()
    const row = screen.getByText('00368').closest('[data-edition]') as HTMLElement
    await fireEvent.drop(row, { dataTransfer: { getData: () => '00364' } })
    expect(onappend).toHaveBeenCalledWith(0, '00364')
  })

  it('shows clip metadata (duration) and sizes the card by duration when clipInfo is given', () => {
    const p = appendClip(addEdition(newProject('/x'), 'E'), 0, '00368')
    const clipInfo = {
      '00368': { id: '00368', durNs: 9699_000_000_000, codec: 'h264', readable: true, audioCount: 2, subCount: 2 },
    }
    render(EditionTracks, { project: p, shared: sharedClipIds(p), clipInfo, onappend: () => {}, onremove: () => {}, onrename: () => {}, onadd: () => {} })
    expect(screen.getByText('2:41:39')).toBeInTheDocument()
    expect(screen.getByText('2a 2s')).toBeInTheDocument()
    // width tracks duration: flex-grow is set to the clip's ns duration
    const card = screen.getByText('00368').closest('div[style]') as HTMLElement
    expect(card.style.flexGrow).toBe('9699000000000')
  })

  it('calls onadd from the new-edition button', async () => {
    const onadd = vi.fn()
    render(EditionTracks, { project: newProject('/x'), shared: new Set<string>(), onappend: () => {}, onremove: () => {}, onrename: () => {}, onadd })
    await fireEvent.click(screen.getByText(/new edition/i))
    expect(onadd).toHaveBeenCalled()
  })

  it('calls ondelete with the edition index from the header delete button', async () => {
    const p = addEdition(addEdition(newProject('/x'), 'Theatrical'), 'Extended')
    const ondelete = vi.fn()
    render(EditionTracks, {
      project: p, shared: new Set<string>(),
      onappend: () => {}, onremove: () => {}, onrename: () => {}, onadd: () => {}, ondelete,
    })
    const btns = screen.getAllByTitle('delete edition')
    await fireEvent.click(btns[1])
    expect(ondelete).toHaveBeenCalledWith(1)
  })
})
