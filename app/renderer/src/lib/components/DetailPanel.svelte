<script lang="ts">
  import type { DiscModel } from '$lib/model'
  import type { Project } from '$lib/project'
  import { chapterCount, fmtResolution, fmtChannels, playlistRows, fmtDuration } from '$lib/model'
  import { isSlotKept, keptSummary, missingKeptSlots } from '$lib/project'
  let { model, selected, project, ontoggleslot }: {
    model: DiscModel | null
    selected: { kind: 'clip' | 'playlist'; id: string } | null
    project: Project | null
    ontoggleslot?: (slot: string) => void
  } = $props()

  let clip = $derived(
    model && selected?.kind === 'clip' ? model.clips[selected.id] : null,
  )
  let allSlotIds = $derived(model ? model.slots.map((s) => s.id) : [])
  let plRow = $derived(
    model && selected?.kind === 'playlist'
      ? playlistRows(model).find((r) => r.file === selected.id)
      : null,
  )
  let pl = $derived(
    model && selected?.kind === 'playlist'
      ? model.playlists.find((p) => p.file === selected.id)
      : null,
  )
</script>

<div class="h-full overflow-auto border-t border-primary-border/20 bg-surface p-2 text-xs dark:bg-surface-dark">
  {#if clip}
    <div class="font-semibold">{selected?.id}</div>
    <div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 opacity-80">
      <span>{fmtResolution(clip.width, clip.height) || 'resolution unknown'}</span>
      <span>{(clip.fps[0] / clip.fps[1]).toFixed(3)} fps</span>
      <span>{fmtDuration(clip.dur_ns)}</span>
      <span>{chapterCount(clip)} ch</span>
      <span>{clip.codec}</span>
    </div>
    <div class="mt-1">
      {#if clip.tracks.length === 0}
        <div class="text-red-400">unreadable</div>
      {:else}
        {#if project}
          {@const sum = keptSummary(project, allSlotIds)}
          <div class="opacity-60">{sum.all ? 'Keeping all tracks' : `Keeping ${sum.kept} of ${sum.total} tracks - applies to every clip`}</div>
        {/if}
        {#each clip.streams.filter((s) => s.kind !== 'video') as s}
          <div class="flex items-center gap-2">
            {#if s.slot && project}
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <input type="checkbox" checked={isSlotKept(project, s.slot)} onchange={() => ontoggleslot?.(s.slot as string)} />
            {/if}
            <span class="opacity-80 {s.slot && project && !isSlotKept(project, s.slot) ? 'line-through opacity-40' : ''}">{s.kind} {s.codec}{s.lang ? ' ' + s.lang : ''}{s.kind === 'audio' && s.channels ? ' ' + fmtChannels(s.channels) : ''}</span>
          </div>
        {/each}
        {#if model && project}
          {@const miss = missingKeptSlots(model, project)}
          {#if miss.length}
            <div class="mt-1 text-amber-400">{miss.length} kept track(s) missing from some clips - build fails in flat/xin1: {miss.map((x) => x.slot).join(', ')}</div>
          {/if}
        {/if}
      {/if}
    </div>
    <div class="mt-1 opacity-50">{clip.path}</div>
  {:else if pl && plRow}
    <div class="font-semibold">{plRow.file}</div>
    <div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 opacity-80">
      <span>{fmtDuration(plRow.durNs)}</span>
      <span>{plRow.itemCount} items / {plRow.uniqueCount} clips</span>
      {#if plRow.angles > 1}<span>{plRow.angles} angles</span>{/if}
      {#if plRow.isDecoy}<span class="text-amber-400">likely decoy</span>{/if}
    </div>
    <div class="mt-1 flex flex-wrap gap-1">
      {#each pl.editions[0].clips as c}
        <span class="rounded border border-primary-border/20 px-1">{c} {model ? fmtDuration(model.clips[c]?.dur_ns ?? 0) : ''}</span>
      {/each}
    </div>
  {:else if model}
    <div class="flex items-center gap-3">
      {#if model.disc.poster_data_url}
        <img class="h-28 rounded" src={model.disc.poster_data_url} alt="disc poster" />
      {/if}
      <div>
        <div class="text-base font-semibold">{model.disc.title ?? model.bdmv}</div>
        <div class="mt-1 opacity-70">
          {model.playlists.length} playlists / {Object.keys(model.clips).length} clips
        </div>
        {#if model.warnings.length}
          <div class="mt-1 text-amber-400">{model.warnings[0].message}</div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="opacity-50">Open a disc to see details.</div>
  {/if}
</div>
