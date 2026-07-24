import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import WelcomeCard from './WelcomeCard.svelte'

describe('WelcomeCard', () => {
  it('renders the app intro and a getting-started hint', () => {
    render(WelcomeCard)
    expect(screen.getByText(/mkv-editions workbench/i)).toBeInTheDocument()
    expect(screen.getByText(/Build editioned MKV files/i)).toBeInTheDocument()
    expect(screen.getByText(/Getting started/i)).toBeInTheDocument()
  })
})
