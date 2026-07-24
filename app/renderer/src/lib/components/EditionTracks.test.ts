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

  it('calls onadd from the new-edition button', async () => {
    const onadd = vi.fn()
    render(EditionTracks, { project: newProject('/x'), shared: new Set<string>(), onappend: () => {}, onremove: () => {}, onrename: () => {}, onadd })
    await fireEvent.click(screen.getByText(/new edition/i))
    expect(onadd).toHaveBeenCalled()
  })
})
