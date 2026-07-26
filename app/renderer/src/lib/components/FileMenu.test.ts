import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import FileMenu from './FileMenu.svelte'

function mount(overrides: Record<string, unknown> = {}) {
  const props = {
    scanning: false, canSave: false,
    onOpenFolder: vi.fn(), onOpenZip: vi.fn(), onOpenIso: vi.fn(),
    onOpenProject: vi.fn(), onSaveProject: vi.fn(),
    onUndo: vi.fn(), onRedo: vi.fn(), onRevert: vi.fn(),
    canUndo: false, canRedo: false, canRevert: false, onInspectChapters: vi.fn(), ...overrides,
  }
  render(FileMenu, props)
  return props
}

describe('FileMenu', () => {
  it('opens on File click, fires the item callback, then closes', async () => {
    const props = mount()
    await fireEvent.click(screen.getByText('File'))
    await fireEvent.click(screen.getByText('Open folder...'))
    expect(props.onOpenFolder).toHaveBeenCalled()
    expect(screen.queryByText('Open ZIP...')).toBeNull()
  })
  it('hides Save project until canSave is true', async () => {
    mount({ canSave: false })
    await fireEvent.click(screen.getByText('File'))
    expect(screen.queryByText('Save project...')).toBeNull()
  })
  it('shows and fires Save project when canSave', async () => {
    const props = mount({ canSave: true })
    await fireEvent.click(screen.getByText('File'))
    await fireEvent.click(screen.getByText('Save project...'))
    expect(props.onSaveProject).toHaveBeenCalled()
  })
  it('disables the open-and-scan items while scanning', async () => {
    mount({ scanning: true })
    await fireEvent.click(screen.getByText('File'))
    expect((screen.getByText('Open folder...') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Open ZIP...') as HTMLButtonElement).disabled).toBe(true)
  })
  it('closes on Escape', async () => {
    mount()
    await fireEvent.click(screen.getByText('File'))
    expect(screen.getByText('Open folder...')).toBeInTheDocument()
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Open folder...')).toBeNull()
  })
  it('closes on an outside click', async () => {
    mount()
    await fireEvent.click(screen.getByText('File'))
    expect(screen.getByText('Open folder...')).toBeInTheDocument()
    await fireEvent.click(document.body)
    expect(screen.queryByText('Open folder...')).toBeNull()
  })
  it('shows Undo/Redo/Revert disabled when their flags are false', async () => {
    mount()
    await fireEvent.click(screen.getByText('File'))
    expect((screen.getByText('Undo') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Redo') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Revert') as HTMLButtonElement).disabled).toBe(true)
  })
  it('fires onUndo when enabled and closes the menu', async () => {
    const props = mount({ canUndo: true })
    await fireEvent.click(screen.getByText('File'))
    await fireEvent.click(screen.getByText('Undo'))
    expect(props.onUndo).toHaveBeenCalled()
    expect(screen.queryByText('Redo')).toBeNull()
  })
  it('invokes onInspectChapters from the menu item', async () => {
    const onInspectChapters = vi.fn()
    const props = mount({ onInspectChapters })
    await fireEvent.click(screen.getByText('File'))
    await fireEvent.click(screen.getByRole('menuitem', { name: /inspect mkv chapters/i }))
    expect(props.onInspectChapters).toHaveBeenCalled()
  })
})
