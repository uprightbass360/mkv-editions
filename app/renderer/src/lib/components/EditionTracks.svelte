<script lang="ts">
  import type { Project } from '$lib/project'
  import type { LibraryClip } from '$lib/model'
  import { fmtDuration } from '$lib/model'
  let { project, shared, clipInfo = {}, onappend, onremove, onrename, onadd, onselect }: {
    project: Project; shared: Set<string>
    clipInfo?: Record<string, LibraryClip>
    onappend: (editionIdx: number, clipId: string) => void
    onremove: (editionIdx: number, clipIdx: number) => void
    onrename: (editionIdx: number, name: string) => void
    onadd: () => void
    onselect?: (clipId: string) => void
  } = $props()

  function onDrop(e: DragEvent, i: number) {
    e.preventDefault()
    const id = e.dataTransfer?.getData('text/plain')
    if (id) onappend(i, id)
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
      <input class="mb-1 w-full bg-transparent font-semibold" value={ed.name} onchange={(e) => onrename(i, (e.target as HTMLInputElement).value)} />
      <div class="flex min-h-20 items-stretch gap-1 overflow-x-auto">
        {#each ed.clips as c, k (k)}
          {@const info = clipInfo[c]}
          <!-- width is proportional to clip duration (a longer clip runs visibly longer); min-width keeps short clips readable -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="flex flex-col justify-between overflow-hidden rounded border p-1 text-xs {shared.has(c) ? 'border-primary bg-primary/15' : 'border-primary-border/20 bg-page dark:bg-page-dark'}"
            style="flex-grow: {info?.durNs ?? 1}; flex-basis: 0; min-width: 3.5rem"
            onclick={() => onselect?.(c)}
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
