import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import DetailPanel from './DetailPanel.svelte'
import { newProject, toggleSlot } from '$lib/project'

const model: any = {
  bdmv: '/x/BDMV',
  disc: { title: 'Sample Disc', poster_data_url: 'data:image/jpeg;base64,AAAA' },
  clips: {
    '00368': {
      path: '/x/BDMV/STREAM/00368.m2ts', dur_ns: 9699e9, codec: 'h264',
      fps: [24000, 1001], width: 1920, height: 1080, marks_ns: [0, 1, 2],
      streams: [
        { pid: 1, kind: 'video', codec: 'h264', lang: null, slot: null },
        { pid: 2, kind: 'audio', codec: 'ac3', lang: 'eng', channels: 6, slot: 'audio:eng:ac3:1' },
        { pid: 3, kind: 'audio', codec: 'ac3', lang: 'spa', channels: 6, slot: 'audio:spa:ac3:1' },
      ],
      tracks: [{ tid: 0, type: 'video', pid: 1 }],
    },
  },
  playlists: [{ file: '00342.mpls', angles: 1, editions: [{ name: '00342', clips: ['00368'] }] }],
  slots: [
    { id: 'audio:eng:ac3:1', kind: 'audio', lang: 'eng', codec: 'ac3', ordinal: 1, present_in: ['00368'], missing_from: [] },
    { id: 'audio:spa:ac3:1', kind: 'audio', lang: 'spa', codec: 'ac3', ordinal: 1, present_in: ['00368'], missing_from: [] },
  ],
  warnings: [],
}

describe('DetailPanel', () => {
  it('shows the disc overview when nothing is selected', () => {
    render(DetailPanel, { model, selected: null, project: null, ontoggleslot: () => {} })
    expect(screen.getByText('Sample Disc')).toBeInTheDocument()
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
  it('shows clip detail with resolution, chapters and stream summary', () => {
    render(DetailPanel, { model, selected: { kind: 'clip', id: '00368' }, project: null, ontoggleslot: () => {} })
    expect(screen.getByText(/1920x1080/)).toBeInTheDocument()
    expect(screen.getByText(/3 ch/i)).toBeInTheDocument()
    expect(screen.getByText(/audio ac3 eng 5\.1/)).toBeInTheDocument()
  })
  it('shows playlist detail', () => {
    render(DetailPanel, { model, selected: { kind: 'playlist', id: '00342.mpls' }, project: null, ontoggleslot: () => {} })
    expect(screen.getByText(/00342\.mpls/)).toBeInTheDocument()
  })
  it('renders a checkbox per audio stream and fires ontoggleslot', async () => {
    const { fireEvent } = await import('@testing-library/svelte')
    const project = { ...newProject('/x/BDMV'), editions: [{ name: 'A', clips: ['00368'] }] }
    const ontoggleslot = vi.fn()
    render(DetailPanel, { model, selected: { kind: 'clip', id: '00368' }, project, ontoggleslot })
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.length).toBe(2)
    await fireEvent.click(boxes[1])
    expect(ontoggleslot).toHaveBeenCalledWith('audio:spa:ac3:1')
  })

  it('shows the keep-count note when narrowed', () => {
    const project = toggleSlot(
      { ...newProject('/x/BDMV'), editions: [{ name: 'A', clips: ['00368'] }] },
      'audio:spa:ac3:1',
      ['audio:eng:ac3:1', 'audio:spa:ac3:1'],
    )
    render(DetailPanel, { model, selected: { kind: 'clip', id: '00368' }, project, ontoggleslot: () => {} })
    expect(screen.getByText(/Keeping 1 of 2 tracks/i)).toBeInTheDocument()
  })
})
