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
    render(BuildModal, { project: buildable(), onclose: () => {}, onedit: vi.fn() })
    await fireEvent.click(screen.getByText(/choose/i))
    // inspect resolves with existing: ['Movie.mkv'] -> warning + checkbox appear
    expect(await screen.findByText(/will be overwritten/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/overwrite existing files/i)).toBeInTheDocument()
  })

  it('keeps Start disabled until overwrite is checked when there are collisions', async () => {
    render(BuildModal, { project: buildable(), onclose: () => {}, onedit: vi.fn() })
    await fireEvent.click(screen.getByText(/choose/i))
    await screen.findByText(/will be overwritten/i)
    const start = screen.getByRole('button', { name: /^start$/i }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    await fireEvent.click(screen.getByLabelText(/overwrite existing files/i))
    expect(start.disabled).toBe(false)
  })

  it('surfaces an inspect failure instead of leaving Start silently disabled', async () => {
    ;(window as any).api.buildInspect = vi.fn(async () => { throw new Error('boom') })
    render(BuildModal, { project: buildable(), onclose: () => {}, onedit: vi.fn() })
    await fireEvent.click(screen.getByText(/choose/i))
    expect(await screen.findByText(/inspect failed: boom/i)).toBeInTheDocument()
    const start = screen.getByRole('button', { name: /^start$/i }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
  })

  it('on completion shows the result + Done and hides the editable inputs', async () => {
    ;(window as any).api.buildInspect = vi.fn(async () => ({ ok: true, outputs: ['Movie.mkv'], existing: [] }))
    render(BuildModal, { project: buildable(), onclose: () => {}, onedit: vi.fn() })
    await fireEvent.click(screen.getByText(/choose/i))
    const start = await screen.findByRole('button', { name: /^start$/i }) as HTMLButtonElement
    await new Promise((r) => setTimeout(r, 0))
    await fireEvent.click(start)
    expect(await screen.findByText(/built 1 file/i)).toBeInTheDocument()
    expect(screen.queryByDisplayValue('movie')).toBeNull() // output-name input hidden
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull() // Start hidden
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()
  })

  it('offers View chapters on a successful build and passes the built paths', async () => {
    ;(window as any).api.buildInspect = vi.fn(async () => ({ ok: true, outputs: ['Movie.mkv'], existing: [] }))
    ;(window as any).api.buildRun = vi.fn(async () => ({ ok: true, outputs: ['/out/Movie.mkv'] }))
    const onviewchapters = vi.fn()
    render(BuildModal, { project: buildable(), onclose: () => {}, onedit: vi.fn(), onviewchapters })
    await fireEvent.click(screen.getByText(/choose/i))
    const start = await screen.findByRole('button', { name: /^start$/i })
    await new Promise((r) => setTimeout(r, 0))
    await fireEvent.click(start)
    const view = await screen.findByRole('button', { name: /view chapters/i })
    await fireEvent.click(view)
    expect(onviewchapters).toHaveBeenCalledWith(['/out/Movie.mkv'])
  })

  it('calls onclose from the Close button', async () => {
    const onclose = vi.fn()
    render(BuildModal, { project: buildable(), onclose, onedit: vi.fn() })
    await fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onclose).toHaveBeenCalled()
  })

  it('routes an output-name edit through onedit instead of two-way bind', async () => {
    const onedit = vi.fn()
    render(BuildModal, { project: buildable(), onclose: () => {}, onedit })
    const input = screen.getByDisplayValue('movie')
    await fireEvent.change(input, { target: { value: 'My Film' } })
    expect(onedit).toHaveBeenCalled()
    const fn = onedit.mock.calls[0][0]
    expect(fn(buildable()).title).toBe('My Film')
  })
})
