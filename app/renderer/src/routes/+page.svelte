<script lang="ts">
  import ClipLibrary from '$lib/components/ClipLibrary.svelte'
  import PlaylistPicker from '$lib/components/PlaylistPicker.svelte'
  import EditionTracks from '$lib/components/EditionTracks.svelte'
  import { libraryClips, playlistRows, longestRealPlaylist, unreadableRatio, type DiscModel } from '$lib/model'
  import {
    newProject, addEdition, appendClip, removeClip, renameEdition, importPlaylist,
    sharedClipIds, toMkvedproj, fromMkvedproj, type Project,
  } from '$lib/project'

  let model = $state<DiscModel | null>(null)
  let project = $state<Project | null>(null)
  let progress = $state('')
  let scanning = $state(false)

  let showIso = $state(false)

  async function scanInto(bdmv: string) {
    let off: (() => void) | undefined
    try {
      off = window.api.onScanProgress((p) => { progress = `probing ${p.clip} (${p.done}/${p.total})` })
      const res = await window.api.scanDisc(bdmv)
      if (!res.ok) { progress = 'scan failed: ' + res.error; return }
      model = res.data as DiscModel
      let p = newProject(model.bdmv)
      const feat = longestRealPlaylist(model)
      if (feat) {
        const pl = model.playlists.find((x) => x.file === feat)!
        p = importPlaylist(p, pl)
        progress = `scan complete - suggested feature ${feat}`
      } else progress = 'scan complete'
      project = p
    } finally { off?.() }
  }

  async function openAndScan(kind: 'folder' | 'zip') {
    scanning = true
    progress = kind === 'zip' ? 'extracting...' : 'opening...'
    let offX: (() => void) | undefined
    try {
      if (kind === 'zip') offX = window.api.onExtractProgress((p) => { progress = `extracting ${p.percent}%` })
      const res = await window.api.openInput(kind)
      if (!res) { progress = ''; return }
      if (!res.ok) { progress = 'open failed: ' + res.error; return }
      offX?.(); offX = undefined
      await scanInto(res.bdmvPath)
    } finally { offX?.(); scanning = false }
  }

  async function pickAndOpen() {
    const r = await window.api.openProject()
    if (!r || !r.ok) return
    try {
      project = fromMkvedproj(r.json)
    } catch (e) {
      progress = 'open failed: ' + String((e as Error).message || e)
    }
  }

  function apply(fn: (p: Project) => Project) { if (project) project = fn(project) }

  let lib = $derived(model ? libraryClips(model) : [])
  let clipInfo = $derived(Object.fromEntries(lib.map((c) => [c.id, c])))
  let rows = $derived(model ? playlistRows(model) : [])
  let shared = $derived(project ? sharedClipIds(project) : new Set<string>())
  let encrypted = $derived(model ? unreadableRatio(model) > 0.5 : false)
</script>

<header class="flex items-center gap-2.5 border-b border-primary-border/15 bg-surface px-2 py-1.5 dark:bg-surface-dark">
  <button class="rounded bg-primary px-3 py-1 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50" onclick={() => openAndScan('folder')} disabled={scanning}>Open folder...</button>
  <button class="rounded bg-primary px-3 py-1 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50" onclick={() => openAndScan('zip')} disabled={scanning}>Open ZIP...</button>
  <button class="rounded border border-primary-border/25 px-2 py-1 hover:bg-primary/10" onclick={() => (showIso = !showIso)}>Open ISO...</button>
  <button class="rounded border border-primary-border/25 px-2 py-1 hover:bg-primary/10" onclick={pickAndOpen}>Open project...</button>
  {#if project}
    <input class="rounded border border-primary-border/25 bg-surface px-1 dark:bg-surface-dark" bind:value={project.title} />
    <select class="rounded border border-primary-border/25 bg-surface px-1 dark:bg-surface-dark" bind:value={project.mode}>
      <option value="flat">flat</option><option value="linked">linked</option><option value="xin1">xin1</option>
    </select>
    <label class="text-sm"><input type="checkbox" bind:checked={project.preserve_chapters} /> preserve chapters</label>
    <button class="rounded border border-primary-border/25 px-2 py-1 hover:bg-primary/10" onclick={async () => { if (project) await window.api.saveProject(toMkvedproj(project), project.title) }}>Save project...</button>
  {/if}
  <span class="ml-auto text-xs opacity-70">{progress}</span>
</header>

{#if showIso}
  <div class="border-b border-primary-border/15 bg-surface p-2 text-xs dark:bg-surface-dark">
    <p>Mount the ISO first, then use "Open folder..." on the mount point:</p>
    <pre class="mt-1 whitespace-pre-wrap">sudo mount -o loop,ro your-disc.iso /mnt/disc
# or rootless (Linux desktop):
udisksctl loop-setup -f your-disc.iso</pre>
  </div>
{/if}

{#if encrypted}
  <div class="border-b border-amber-600 bg-amber-900/40 p-2 text-xs">
    Most clips are unreadable - this image may be AACS-encrypted or not decrypted.
  </div>
{/if}

<main class="grid h-[calc(100vh-52px)] grid-cols-[220px_1fr_300px] gap-2.5 p-2.5">
  <section class="flex flex-col overflow-hidden"><h3 class="mb-1.5 text-xs font-bold uppercase tracking-wider text-primary-text dark:text-primary-text-dark">Clips</h3><ClipLibrary clips={lib} /></section>
  <section class="flex flex-col overflow-hidden">
    <h3 class="mb-1.5 text-xs font-bold uppercase tracking-wider text-primary-text dark:text-primary-text-dark">Editions</h3>
    {#if project}
      <EditionTracks
        {project} {shared} {clipInfo}
        onappend={(i, id) => apply((p) => appendClip(p, i, id))}
        onremove={(i, k) => apply((p) => removeClip(p, i, k))}
        onrename={(i, name) => apply((p) => renameEdition(p, i, name))}
        onadd={() => apply((p) => addEdition(p, `Edition ${p.editions.length + 1}`))}
      />
    {/if}
  </section>
  <section class="flex flex-col overflow-hidden">
    <h3 class="mb-1.5 text-xs font-bold uppercase tracking-wider text-primary-text dark:text-primary-text-dark">Playlists</h3>
    <PlaylistPicker {rows} onimport={(file) => {
      const pl = model?.playlists.find((p) => p.file === file)
      if (pl) apply((p) => importPlaylist(p, pl))
    }} />
  </section>
</main>
