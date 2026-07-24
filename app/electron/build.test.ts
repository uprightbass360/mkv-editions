import { describe, it, expect } from 'vitest'
import { expectedOutputs, unshellFirst } from './build'

describe('unshellFirst', () => {
  it('reads a bare token up to the next space', () => {
    expect(unshellFirst('seg0.mkv --no-chapters foo')).toBe('seg0.mkv')
  })
  it('reads a single-quoted token with spaces and braces', () => {
    expect(unshellFirst("'Movie {edition-Theatrical}.mkv' --chapters c.xml")).toBe('Movie {edition-Theatrical}.mkv')
  })
  it('decodes an inner single quote encoded by shlex.quote', () => {
    // shlex.quote("Rock 'n' Roll.mkv") -> 'Rock '"'"'n'"'"' Roll.mkv'
    const s = "'Rock '\"'\"'n'\"'\"' Roll.mkv' --x"
    expect(unshellFirst(s)).toBe("Rock 'n' Roll.mkv")
  })
})

describe('expectedOutputs', () => {
  it('collects the -o targets from a flat build.sh', () => {
    const sh = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      "mkvmerge -o 'Movie {edition-Theatrical}.mkv' --chapters 'Movie {edition-Theatrical}.chapters.xml' foo.m2ts",
      "mkvmerge -o 'Movie {edition-Extended}.mkv' bar.m2ts",
    ].join('\n')
    expect(expectedOutputs(sh)).toEqual([
      'Movie {edition-Theatrical}.mkv',
      'Movie {edition-Extended}.mkv',
    ])
  })
  it('ignores non-mkvmerge lines', () => {
    expect(expectedOutputs('echo hi\nmkvmerge -o out.mkv a.m2ts\n')).toEqual(['out.mkv'])
  })
})
