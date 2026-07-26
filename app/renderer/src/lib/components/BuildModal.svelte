<script lang="ts">
  import type { Project } from '$lib/project'
  import { toMkvedproj, hasBuildableEdition, canStartBuild } from '$lib/project'

  let { project, onclose, onedit }: {
    project: Project
    onclose: () => void
    onedit: (fn: (p: Project) => Project) => void
  } = $props()

  let folder = $state<string | null>(null)
  let outputs = $state<string[]>([])
  let existing = $state<string[]>([])
  let inspected = $state(false)
  let inspecting = $state(false)
  let inspectError = $state('')
  let overwrite = $state(false)
  let running = $state(false)
  let percent = $state(0)
  let log = $state('')
  let result = $state('')
  let failed = $derived(result.startsWith('Build failed'))
  let logEl = $state<HTMLPreElement | undefined>()

  // Keep the log scrolled to the live tail as build output streams in.
  $effect(() => {
    log
    if (logEl) logEl.scrollTop = logEl.scrollHeight
  })

  let buildable = $derived(hasBuildableEdition(project))
  let startable = $derived(
    canStartBuild({ folder, buildable, running, inspected, existingCount: existing.length, overwrite }),
  )

  async function inspect() {
    if (!folder) return
    inspecting = true
    inspected = false
    inspectError = ''
    try {
      const res = await window.api.buildInspect(toMkvedproj(project), folder)
      if (!res.ok) { inspectError = res.error; outputs = []; existing = []; return }
      outputs = res.outputs
      existing = res.existing
      inspected = true
    } catch (e) {
      // A rejected invoke (previously left Start silently disabled with no reason).
      inspectError = 'inspect failed: ' + String((e as Error).message || e)
      outputs = []
      existing = []
    } finally {
      inspecting = false
    }
  }

  async function choose() {
    const f = await window.api.buildPickFolder()
    if (!f) return
    overwrite = false
    folder = f
  }

  // Re-inspect whenever the output folder or a filename-affecting setting changes.
  $effect(() => {
    const _deps = [folder, project.title, project.mode]
    void _deps
    if (folder) inspect()
  })

  async function start() {
    if (!folder) return
    running = true
    result = ''
    log = ''
    percent = 0
    let offP: (() => void) | undefined
    let offL: (() => void) | undefined
    try {
      offP = window.api.onBuildProgress((p) => { percent = p.percent })
      offL = window.api.onBuildLog((p) => { log += p.line + '\n' })
      const res = await window.api.buildRun(toMkvedproj(project), folder, overwrite)
      result = res.ok ? `Built ${res.outputs.length} file(s) in ${folder}` : 'Build failed: ' + res.error
    } catch (e) {
      result = 'Build failed: ' + String((e as Error).message || e)
    } finally { offP?.(); offL?.(); running = false }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
  <div class="flex max-h-[90vh] w-[560px] flex-col gap-3 overflow-auto rounded-lg border border-primary-border/30 bg-surface p-4 text-sm dark:bg-surface-dark">
    <div class="flex items-center justify-between">
      <h2 class="text-base font-semibold">{result ? (failed ? 'Build failed' : 'Build complete') : running ? 'Building...' : 'Build movie'}</h2>
      <button class="opacity-60 hover:opacity-100 disabled:opacity-30" title="close" onclick={onclose} disabled={running}>x</button>
    </div>

    {#if !running && !result}
      <label class="flex items-center gap-2">Output name
        <input class="flex-1 rounded border border-primary-border/25 bg-page px-1 dark:bg-page-dark" value={project.title} onchange={(e) => onedit((p) => ({ ...p, title: (e.target as HTMLInputElement).value }))} />
      </label>
      <label class="flex items-center gap-2">Mode
        <select class="rounded border border-primary-border/25 bg-page px-1 dark:bg-page-dark" value={project.mode} onchange={(e) => onedit((p) => ({ ...p, mode: (e.target as HTMLSelectElement).value as Project['mode'] }))}>
          <option value="flat">flat</option><option value="linked">linked</option><option value="xin1">xin1</option>
        </select>
      </label>
      <label class="flex items-center gap-2"><input type="checkbox" checked={project.preserve_chapters} onchange={(e) => onedit((p) => ({ ...p, preserve_chapters: (e.target as HTMLInputElement).checked }))} /> preserve chapters</label>

      <div class="flex items-center gap-2">
        <span class="truncate opacity-80">{folder ?? 'No output folder chosen'}</span>
        <button class="ml-auto rounded border border-primary-border/25 px-2 py-0.5 hover:bg-primary/10" onclick={choose}>Choose...</button>
      </div>

      {#if inspecting}
        <div class="opacity-70">checking output folder...</div>
      {:else if inspectError}
        <div class="text-red-400">{inspectError}</div>
      {:else if inspected}
        <div class="opacity-80">Will write {outputs.length} file(s): {outputs.join(', ')}</div>
        {#if existing.length}
          <div class="text-amber-400">{existing.length} file(s) will be overwritten: {existing.join(', ')}</div>
          <label class="flex items-center gap-2"><input type="checkbox" bind:checked={overwrite} /> Overwrite existing files</label>
        {/if}
      {/if}

      <div class="mt-1 flex justify-end gap-2">
        <button class="rounded bg-primary px-3 py-1 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50" onclick={start} disabled={!startable}>Start</button>
        <button class="rounded border border-primary-border/25 px-3 py-1 hover:bg-primary/10" onclick={onclose}>Close</button>
      </div>

    {:else if running}
      <div class="opacity-80">Building {project.title || 'movie'}...</div>
      <div class="flex items-center gap-2">
        <div class="h-2 flex-1 overflow-hidden rounded bg-page dark:bg-page-dark">
          <div class="h-full bg-primary transition-[width]" style="width: {percent}%"></div>
        </div>
        <span class="w-14 text-right text-xs tabular-nums opacity-70">{percent}%</span>
      </div>
      <pre bind:this={logEl} class="h-40 overflow-auto rounded border border-primary-border/20 bg-page p-1 text-xs dark:bg-page-dark">{log}</pre>
      <div class="mt-1 flex justify-end gap-2">
        <button class="rounded border border-primary-border/25 px-3 py-1 opacity-50" disabled>Close</button>
      </div>

    {:else}
      <div class="py-3 text-center text-base font-semibold {failed ? 'text-red-400' : 'text-primary'}">{result}</div>
      {#if failed && log}
        <pre class="h-40 overflow-auto rounded border border-primary-border/20 bg-page p-1 text-xs dark:bg-page-dark">{log}</pre>
      {/if}
      <div class="mt-1 flex justify-end gap-2">
        <button class="rounded bg-primary px-3 py-1 font-semibold text-on-primary hover:bg-primary-hover" onclick={onclose}>Done</button>
      </div>
    {/if}
  </div>
</div>
