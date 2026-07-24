/** Decode the first shell token as Python shlex.quote produces it: a bare
 * token (read to the next space), or a single-quoted string whose inner single
 * quotes are encoded as the 5-char sequence '"'"' (close, "'", reopen). */
export function unshellFirst(s: string): string {
  if (s[0] !== "'") {
    const sp = s.indexOf(' ')
    return sp < 0 ? s : s.slice(0, sp)
  }
  let i = 1
  let res = ''
  while (i < s.length) {
    if (s[i] === "'") {
      if (s.slice(i, i + 5) === `'"'"'`) { res += "'"; i += 5; continue }
      break
    }
    res += s[i]
    i++
  }
  return res
}

/** The -o target filenames (in order) a generated build.sh will write. */
export function expectedOutputs(buildSh: string): string[] {
  const out: string[] = []
  const prefix = 'mkvmerge -o '
  for (const raw of buildSh.split('\n')) {
    const line = raw.trimStart()
    if (!line.startsWith(prefix)) continue
    out.push(unshellFirst(line.slice(prefix.length)))
  }
  return out
}
