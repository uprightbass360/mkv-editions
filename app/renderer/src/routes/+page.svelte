<script lang="ts">
  import ClipLibrary from '$lib/components/ClipLibrary.svelte'
  import PlaylistPicker from '$lib/components/PlaylistPicker.svelte'
  import EditionTracks from '$lib/components/EditionTracks.svelte'
  import DetailPanel from '$lib/components/DetailPanel.svelte'
  import BuildModal from '$lib/components/BuildModal.svelte'
  import FileMenu from '$lib/components/FileMenu.svelte'
  import IsoHelpModal from '$lib/components/IsoHelpModal.svelte'
  import WelcomeCard from '$lib/components/WelcomeCard.svelte'
  import { libraryClips, playlistRows, longestRealPlaylist, unreadableRatio, chapterCount, type DiscModel } from '$lib/model'
  import {
    newProject, addEdition, appendClip, removeClip, renameEdition, removeEdition, importPlaylist,
    sharedClipIds, toMkvedproj, fromMkvedproj, hasBuildableEdition, toggleSlot, moveClip, type Project,
  } from '$lib/project'

  let model = $state<DiscModel | null>(null)
  let project = $state<Project | null>(null)
  let progress = $state('')
  let scanning = $state(false)

  let showIso = $state(false)
  let showBuild = $state(false)

  let selected = $state<{ kind: 'clip' | 'playlist'; id: string } | null>(null)

  async function scanInto(bdmv: string) {
    let off: (() => void) | undefined
    try {
      off = window.api.onScanProgress((p) => { progress = `probing ${p.clip} (${p.done}/${p.total})` })
      const res = await window.api.scanDisc(bdmv)
      if (!res.ok) { progress = 'scan failed: ' + res.error; return }
      model = res.data as DiscModel
      selected = null
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

  async function saveProject() {
    if (project) await window.api.saveProject(toMkvedproj(project), project.title)
  }

  function apply(fn: (p: Project) => Project) { if (project) project = fn(project) }

  let canBuild = $derived(!!project && hasBuildableEdition(project))
  let lib = $derived(model ? libraryClips(model) : [])
  let clipInfo = $derived(Object.fromEntries(lib.map((c) => [c.id, c])))
  let rows = $derived(model ? playlistRows(model) : [])
  let shared = $derived(project ? sharedClipIds(project) : new Set<string>())
  let encrypted = $derived(model ? unreadableRatio(model) > 0.5 : false)
  let clipChapters = $derived(model ? Object.fromEntries(Object.entries(model.clips).map(([id, c]) => [id, chapterCount(c)])) : {})
  let playlistChapters = $derived(
    model ? Object.fromEntries(model.playlists.map((p) => [p.file, p.editions[0].clips.reduce((n, c) => n + (model!.clips[c] ? chapterCount(model!.clips[c]) : 0), 0)])) : {},
  )
</script>

<div class="flex h-screen flex-col">
  <header class="flex items-center gap-2.5 border-b border-primary-border/15 bg-surface px-2 py-1.5 dark:bg-surface-dark">
    <FileMenu
      scanning={scanning}
      canSave={!!project}
      onOpenFolder={() => openAndScan('folder')}
      onOpenZip={() => openAndScan('zip')}
      onOpenIso={() => (showIso = true)}
      onOpenProject={pickAndOpen}
      onSaveProject={saveProject}
    />
    <span class="ml-auto text-xs opacity-70">{progress}</span>
  </header>

  {#if project}
    <div class="flex items-center gap-2.5 border-b border-primary-border/15 bg-surface px-2 py-1 dark:bg-surface-dark">
      {#if model?.disc.title}<span class="text-sm font-semibold opacity-90">{model.disc.title}</span>{/if}
      <button class="rounded bg-primary px-3 py-1 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50" onclick={() => (showBuild = true)} disabled={!canBuild}>Build...</button>
    </div>
  {/if}

  {#if encrypted}
    <div class="shrink-0 border-b border-amber-600 bg-amber-900/40 p-2 text-xs">
      Most clips are unreadable - this image may be AACS-encrypted or not decrypted.
    </div>
  {/if}

  {#if !model && !project}
    <div class="min-h-0 flex-1"><WelcomeCard /></div>
  {:else}
    <div class="flex min-h-0 flex-1 flex-col">
      <main class="grid min-h-0 flex-1 grid-cols-[220px_1fr_300px] gap-2.5 p-2.5">
        <section class="flex flex-col overflow-hidden">
          <h3 class="mb-1.5 text-xs font-bold uppercase tracking-wider text-primary-text dark:text-primary-text-dark">Clips</h3>
          <ClipLibrary clips={lib} chapters={clipChapters} selectedId={selected?.kind === 'clip' ? selected.id : undefined} onselect={(id) => (selected = { kind: 'clip', id })} />
        </section>
        <section class="flex flex-col overflow-hidden">
          <h3 class="mb-1.5 text-xs font-bold uppercase tracking-wider text-primary-text dark:text-primary-text-dark">Editions</h3>
          {#if project}
            <EditionTracks
              {project} {shared} {clipInfo}
              onselect={(id) => (selected = { kind: 'clip', id })}
              onappend={(i, id) => apply((p) => appendClip(p, i, id))}
              onremove={(i, k) => apply((p) => removeClip(p, i, k))}
              onrename={(i, name) => apply((p) => renameEdition(p, i, name))}
              onadd={() => apply((p) => addEdition(p, `Edition ${p.editions.length + 1}`))}
              ondelete={(i) => apply((p) => removeEdition(p, i))}
              onmove={(i, from, to) => apply((p) => moveClip(p, i, from, to))}
            />
          {/if}
        </section>
        <section class="flex flex-col overflow-hidden">
          <h3 class="mb-1.5 text-xs font-bold uppercase tracking-wider text-primary-text dark:text-primary-text-dark">Playlists</h3>
          <PlaylistPicker
            {rows} chapters={playlistChapters}
            selectedFile={selected?.kind === 'playlist' ? selected.id : undefined}
            onselect={(file) => (selected = { kind: 'playlist', id: file })}
            onimport={(file) => { const pl = model?.playlists.find((p) => p.file === file); if (pl) apply((p) => importPlaylist(p, pl)) }}
          />
        </section>
      </main>
      <div class="h-40 shrink-0">
        <DetailPanel {model} {selected} {project}
          ontoggleslot={(slot) => apply((p) => toggleSlot(p, slot, model ? model.slots.map((s) => s.id) : []))}
        />
      </div>
    </div>
  {/if}
</div>

{#if showBuild && project}
  <BuildModal {project} onclose={() => (showBuild = false)} />
{/if}

{#if showIso}
  <IsoHelpModal onclose={() => (showIso = false)} />
{/if}
