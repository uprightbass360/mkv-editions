import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import DetailPanel from './DetailPanel.svelte'

const model: any = {
  bdmv: '/x/BDMV',
  disc: { title: 'Sample Disc', poster_data_url: 'data:image/jpeg;base64,AAAA' },
  clips: {
    '00368': {
      path: '/x/BDMV/STREAM/00368.m2ts', dur_ns: 9699e9, codec: 'h264',
      fps: [24000, 1001], width: 1920, height: 1080, marks_ns: [0, 1, 2],
      streams: [
        { pid: 1, kind: 'video', codec: 'h264', lang: null },
        { pid: 2, kind: 'audio', codec: 'ac3', lang: 'eng', channels: 6 },
      ],
      tracks: [{ tid: 0, type: 'video', pid: 1 }],
    },
  },
  playlists: [{ file: '00342.mpls', angles: 1, editions: [{ name: '00342', clips: ['00368'] }] }],
  slots: [], warnings: [],
}

describe('DetailPanel', () => {
  it('shows the disc overview when nothing is selected', () => {
    render(DetailPanel, { model, selected: null })
    expect(screen.getByText('Sample Disc')).toBeInTheDocument()
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
  it('shows clip detail with resolution, chapters and stream summary', () => {
    render(DetailPanel, { model, selected: { kind: 'clip', id: '00368' } })
    expect(screen.getByText(/1920x1080/)).toBeInTheDocument()
    expect(screen.getByText(/3 ch/i)).toBeInTheDocument()
    expect(screen.getByText(/audio ac3 eng 5\.1/)).toBeInTheDocument()
  })
  it('shows playlist detail', () => {
    render(DetailPanel, { model, selected: { kind: 'playlist', id: '00342.mpls' } })
    expect(screen.getByText(/00342\.mpls/)).toBeInTheDocument()
  })
})
