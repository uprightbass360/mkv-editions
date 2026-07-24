import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import BuildModal from './BuildModal.svelte'
import { newProject, addEdition, appendClip } from '$lib/project'

function buildable() {
  return appendClip(addEdition(newProject('/x'), 'Theatrical'), 0, '00001')
}

beforeEach(() => {
  ;(window as any).api = {
    buildPickFolder: vi.fn(async () => '/out'),
    buildInspect: vi.fn(async () => ({ ok: true, outputs: ['Movie.mkv'], existing: ['Movie.mkv'] })),
    buildRun: vi.fn(async () => ({ ok: true, outputs: ['/out/Movie.mkv'] })),
    onBuildProgress: vi.fn(() => () => {}),
    onBuildLog: vi.fn(() => () => {}),
  }
})

describe('BuildModal', () => {
  it('shows the collision warning and overwrite checkbox after inspecting a folder with existing files', async () => {
    render(BuildModal, { project: buildable(), onclose: () => {} })
    await fireEvent.click(screen.getByText(/choose/i))
    // inspect resolves with existing: ['Movie.mkv'] -> warning + checkbox appear
    expect(await screen.findByText(/will be overwritten/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/overwrite existing files/i)).toBeInTheDocument()
  })

  it('keeps Start disabled until overwrite is checked when there are collisions', async () => {
    render(BuildModal, { project: buildable(), onclose: () => {} })
    await fireEvent.click(screen.getByText(/choose/i))
    await screen.findByText(/will be overwritten/i)
    const start = screen.getByRole('button', { name: /^start$/i }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    await fireEvent.click(screen.getByLabelText(/overwrite existing files/i))
    expect(start.disabled).toBe(false)
  })

  it('calls onclose from the Close button', async () => {
    const onclose = vi.fn()
    render(BuildModal, { project: buildable(), onclose })
    await fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onclose).toHaveBeenCalled()
  })
})
