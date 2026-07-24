import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import IsoHelpModal from './IsoHelpModal.svelte'

describe('IsoHelpModal', () => {
  it('shows the mount instructions', () => {
    render(IsoHelpModal, { onclose: () => {} })
    expect(screen.getByText(/Mount the ISO first/)).toBeInTheDocument()
    expect(screen.getByText(/loop,ro/)).toBeInTheDocument()
  })
  it('calls onclose from the Close button', async () => {
    const onclose = vi.fn()
    render(IsoHelpModal, { onclose })
    await fireEvent.click(screen.getByText('Close'))
    expect(onclose).toHaveBeenCalled()
  })
  it('calls onclose on Escape', async () => {
    const onclose = vi.fn()
    render(IsoHelpModal, { onclose })
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(onclose).toHaveBeenCalled()
  })
})
