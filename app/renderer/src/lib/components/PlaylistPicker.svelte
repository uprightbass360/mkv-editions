<script lang="ts">
  import type { PlaylistRow } from '$lib/model'
  import { fmtDuration } from '$lib/model'
  let { rows, onimport }: { rows: PlaylistRow[]; onimport: (file: string) => void } = $props()
  let q = $state('')
  let shown = $derived(rows.filter((r) => r.file.includes(q)))
</script>

<div class="flex flex-col gap-1 overflow-y-auto">
  <input class="mb-1.5 rounded border border-primary-border/25 bg-surface px-1 dark:bg-surface-dark" type="text" placeholder="filter playlists" bind:value={q} />
  {#each shown as r (r.file)}
    <div class="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-primary/10 {r.isDecoy ? 'opacity-50' : ''}">
      <span>{r.file}</span>
      <span class="opacity-70">{fmtDuration(r.durNs)}</span>
      <span class="opacity-70">{r.itemCount} items / {r.uniqueCount} clips</span>
      {#if r.angles > 1}<span class="text-primary-text dark:text-primary-text-dark">{r.angles} angles</span>{/if}
      {#if r.isDecoy}<span class="text-amber-400 text-[10px]">likely decoy</span>{/if}
      <button class="ml-auto rounded border border-primary-border/25 bg-primary/15 px-1.5 hover:bg-primary/25" onclick={() => onimport(r.file)}>import</button>
    </div>
  {/each}
</div>
