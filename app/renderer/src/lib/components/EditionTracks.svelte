<script lang="ts">
  import type { Project } from '$lib/project'
  import type { LibraryClip } from '$lib/model'
  import { fmtDuration } from '$lib/model'
  let { project, shared, clipInfo = {}, onappend, onremove, onrename, onadd, onselect, ondelete, onmove }: {
    project: Project; shared: Set<string>
    clipInfo?: Record<string, LibraryClip>
    onappend: (editionIdx: number, clipId: string) => void
    onremove: (editionIdx: number, clipIdx: number) => void
    onrename: (editionIdx: number, name: string) => void
    onadd: () => void
    onselect?: (clipId: string) => void
    ondelete?: (editionIdx: number) => void
    onmove?: (editionIdx: number, from: number, to: number) => void
  } = $props()

  function onDrop(e: DragEvent, i: number) {
    e.preventDefault()
    const raw = e.dataTransfer?.getData('text/plain') ?? ''
    const m = raw.match(/^move:(\d+):(\d+)$/)
    if (m) {
      if (Number(m[1]) === i) onmove?.(i, Number(m[2]), project.editions[i].clips.length - 1)
      return
    }
    if (raw) onappend(i, raw)
  }

  function onCardDragStart(e: DragEvent, i: number, k: number) {
    e.dataTransfer?.setData('text/plain', `move:${i}:${k}`)
  }

  function onCardDrop(e: DragEvent, i: number, k: number) {
    e.preventDefault()
    e.stopPropagation()
    const raw = e.dataTransfer?.getData('text/plain') ?? ''
    const m = raw.match(/^move:(\d+):(\d+)$/)
    if (m) {
      if (Number(m[1]) === i && Number(m[2]) !== k) onmove?.(i, Number(m[2]), k)
    } else if (raw) {
      onappend(i, raw)
    }
  }
</script>

<div class="flex flex-col gap-2">
  {#each project.editions as ed, i (i)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      data-edition
      class="rounded-md border border-dashed border-primary-border/30 bg-surface p-1.5 dark:bg-surface-dark"
      ondrop={(e) => onDrop(e, i)}
      ondragover={(e) => e.preventDefault()}
    >
      <div class="mb-1 flex items-center gap-1">
        <input class="w-full bg-transparent font-semibold" value={ed.name} onchange={(e) => onrename(i, (e.target as HTMLInputElement).value)} />
        <button class="leading-none opacity-50 hover:opacity-100" title="delete edition" onclick={(e) => { e.stopPropagation(); ondelete?.(i) }}>x</button>
      </div>
      <div class="flex min-h-20 items-stretch gap-1 overflow-x-auto">
        {#each ed.clips as c, k (k)}
          {@const info = clipInfo[c]}
          <!-- width is proportional to clip duration (a longer clip runs visibly longer); min-width keeps short clips readable -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="flex cursor-grab flex-col justify-between overflow-hidden rounded border p-1 text-xs select-none {shared.has(c) ? 'border-primary bg-primary/15' : 'border-primary-border/20 bg-page dark:bg-page-dark'}"
            style="flex-grow: {info?.durNs ?? 1}; flex-basis: 0; min-width: 3.5rem"
            onclick={() => onselect?.(c)}
            draggable={true}
            ondragstart={(e) => onCardDragStart(e, i, k)}
            ondragover={(e) => e.preventDefault()}
            ondrop={(e) => onCardDrop(e, i, k)}
          >
            <div class="flex items-start justify-between gap-1">
              <span class="font-medium">{c}</span>
              <button class="leading-none opacity-50 hover:opacity-100" title="remove" onclick={(e) => { e.stopPropagation(); onremove(i, k) }}>x</button>
            </div>
            {#if info}
              <div class="mt-1 opacity-70">{fmtDuration(info.durNs)}</div>
              {#if info.readable}
                <div class="opacity-70">{info.audioCount}a {info.subCount}s</div>
              {:else}
                <div class="text-red-400">unreadable</div>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/each}
  <button class="self-start rounded border border-primary-border/25 px-2 py-1 text-sm hover:bg-primary/10" onclick={() => onadd()}>+ new edition</button>
</div>
