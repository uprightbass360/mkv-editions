<script lang="ts">
  import ClipLibrary from '$lib/components/ClipLibrary.svelte'
  import PlaylistPicker from '$lib/components/PlaylistPicker.svelte'
  import EditionTracks from '$lib/components/EditionTracks.svelte'
  import { libraryClips, playlistRows, longestRealPlaylist, type DiscModel } from '$lib/model'
  import {
    newProject, addEdition, appendClip, removeClip, renameEdition, importPlaylist,
    sharedClipIds, toMkvedproj, fromMkvedproj, type Project,
  } from '$lib/project'

  let model = $state<DiscModel | null>(null)
  let project = $state<Project | null>(null)
  let progress = $state('')
  let scanning = $state(false)

  async function pickAndScan() {
    const bdmv = await window.api.pickBdmv()
    if (!bdmv) return
    scanning = true
    progress = 'scanning...'
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
    } finally {
      off?.()
      scanning = false
    }
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
  let rows = $derived(model ? playlistRows(model) : [])
  let shared = $derived(project ? sharedClipIds(project) : new Set<string>())
</script>

<header class="flex items-center gap-2.5 border-b border-slate-700 p-2">
  <button class="rounded bg-indigo-600 px-3 py-1" onclick={pickAndScan} disabled={scanning}>Open BDMV...</button>
  <button class="rounded bg-slate-700 px-2 py-1" onclick={pickAndOpen}>Open project...</button>
  {#if project}
    <input class="bg-slate-800 px-1" bind:value={project.title} />
    <select class="bg-slate-800" bind:value={project.mode}>
      <option value="flat">flat</option><option value="linked">linked</option><option value="xin1">xin1</option>
    </select>
    <label><input type="checkbox" bind:checked={project.preserve_chapters} /> preserve chapters</label>
    <button class="rounded bg-slate-700 px-2 py-1" onclick={async () => { if (project) await window.api.saveProject(toMkvedproj(project), project.title) }}>Save project...</button>
  {/if}
  <span class="ml-auto text-xs opacity-70">{progress}</span>
</header>

<main class="grid h-[calc(100vh-52px)] grid-cols-[220px_1fr_300px] gap-2.5 p-2.5">
  <section class="flex flex-col overflow-hidden"><h3 class="mb-1.5 text-sm">Clips</h3><ClipLibrary clips={lib} /></section>
  <section class="flex flex-col overflow-hidden">
    <h3 class="mb-1.5 text-sm">Editions</h3>
    {#if project}
      <EditionTracks
        {project} {shared}
        onappend={(i, id) => apply((p) => appendClip(p, i, id))}
        onremove={(i, k) => apply((p) => removeClip(p, i, k))}
        onrename={(i, name) => apply((p) => renameEdition(p, i, name))}
        onadd={() => apply((p) => addEdition(p, `Edition ${p.editions.length + 1}`))}
      />
    {/if}
  </section>
  <section class="flex flex-col overflow-hidden">
    <h3 class="mb-1.5 text-sm">Playlists</h3>
    <PlaylistPicker {rows} onimport={(file) => {
      const pl = model?.playlists.find((p) => p.file === file)
      if (pl) apply((p) => importPlaylist(p, pl))
    }} />
  </section>
</main>
