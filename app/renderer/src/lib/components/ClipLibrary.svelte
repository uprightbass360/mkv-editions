<script lang="ts">
  import type { LibraryClip } from '$lib/model'
  import { fmtDuration } from '$lib/model'
  let { clips, chapters = {}, selectedId, onselect }: {
    clips: LibraryClip[]
    chapters?: Record<string, number>
    selectedId?: string
    onselect?: (id: string) => void
  } = $props()
  function onDragStart(e: DragEvent, id: string) {
    e.dataTransfer?.setData('text/plain', id)
  }
</script>

<div class="flex flex-col gap-1 overflow-y-auto">
  {#each clips as c (c.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="flex gap-2 rounded border bg-surface px-1.5 py-1 text-xs dark:bg-surface-dark {c.id === selectedId ? 'border-primary ring-1 ring-primary' : 'border-primary-border/20'} {c.readable ? 'cursor-grab hover:border-primary/60' : 'cursor-not-allowed opacity-50'}"
      draggable={c.readable}
      ondragstart={(e) => onDragStart(e, c.id)}
      onclick={() => onselect?.(c.id)}
    >
      <span class="font-medium">{c.id}</span>
      <span class="opacity-70">{fmtDuration(c.durNs)}</span>
      {#if c.readable}
        <span class="opacity-70">{c.audioCount}a {c.subCount}s</span>
      {:else}
        <span class="text-red-400">unreadable</span>
      {/if}
      {#if chapters[c.id] != null}<span class="ml-auto opacity-60">{chapters[c.id]} ch</span>{/if}
    </div>
  {/each}
</div>
