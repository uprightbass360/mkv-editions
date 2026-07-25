import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import ClipLibrary from './ClipLibrary.svelte'
import type { LibraryClip } from '$lib/model'

const clips: LibraryClip[] = [
  { id: '00368', durNs: 9600e9, codec: 'h264', readable: true, audioCount: 2, subCount: 2 },
  { id: '00666', durNs: 40e9, codec: 'h264', readable: false, audioCount: 0, subCount: 0 },
]

describe('ClipLibrary', () => {
  it('renders clips and marks the unreadable one', () => {
    render(ClipLibrary, { clips })
    expect(screen.getByText('00368')).toBeInTheDocument()
    expect(screen.getByText(/unreadable/i)).toBeInTheDocument()
  })

  it('shows chapter count and calls onselect on click', async () => {
    const clips = [{ id: '00368', durNs: 9600e9, codec: 'h264', readable: true, audioCount: 2, subCount: 2 }]
    const onselect = vi.fn()
    const { getByText } = render(ClipLibrary, { clips, chapters: { '00368': 16 }, onselect })
    expect(getByText(/16 ch/)).toBeTruthy()
    await fireEvent.click(getByText('00368'))
    expect(onselect).toHaveBeenCalledWith('00368')
  })
})
