<script lang="ts">
  import type { LibraryClip } from '$lib/model'
  import { fmtDuration } from '$lib/model'
  let { clips }: { clips: LibraryClip[] } = $props()
  function onDragStart(e: DragEvent, id: string) {
    e.dataTransfer?.setData('text/plain', id)
  }
</script>

<div class="flex flex-col gap-1 overflow-y-auto">
  {#each clips as c (c.id)}
    <div
      class="flex gap-2 rounded border border-slate-600 px-1.5 py-1 text-xs {c.readable ? 'cursor-grab' : 'cursor-not-allowed opacity-50'}"
      draggable={c.readable}
      ondragstart={(e) => onDragStart(e, c.id)}
    >
      <span class="font-medium">{c.id}</span>
      <span class="opacity-70">{fmtDuration(c.durNs)}</span>
      {#if c.readable}
        <span class="opacity-70">{c.audioCount}a {c.subCount}s</span>
      {:else}
        <span class="text-red-400">unreadable</span>
      {/if}
    </div>
  {/each}
</div>
