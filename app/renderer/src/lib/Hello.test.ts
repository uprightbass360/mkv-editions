import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import Hello from './Hello.svelte'

describe('Hello', () => {
  it('renders the given name', () => {
    render(Hello, { name: 'World' })
    expect(screen.getByText('Hello World!')).toBeInTheDocument()
  })
})
