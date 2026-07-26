<script lang="ts">
  import { fmtDuration } from '$lib/model'
  import { isChaptersError, type InspectChaptersResult } from '$lib/chapters'

  let { result, onclose }: { result: InspectChaptersResult; onclose: () => void } = $props()

  let showHidden = $state(false)
  let err = $derived(isChaptersError(result) ? result.error : null)
  let data = $derived(isChaptersError(result) ? null : result)

  // Which editions are expanded; default edition (else the first) starts open.
  let expanded = $state<Record<number, boolean>>({})
  $effect(() => {
    if (!data) return
    const di = data.editions.findIndex((e) => e.default)
    expanded = { [di >= 0 ? di : 0]: true }
  })

  function toggle(i: number) { expanded = { ...expanded, [i]: !expanded[i] } }
  function fileName(p: string) { return p.split('/').pop() || p }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
  <div class="flex max-h-[90vh] w-[620px] flex-col gap-3 overflow-auto rounded-lg border border-primary-border/30 bg-surface p-4 text-sm dark:bg-surface-dark">
    <div class="flex items-center justify-between">
      <h2 class="text-base font-semibold">Chapters {data ? '- ' + fileName(data.file) : ''}</h2>
      <button class="opacity-60 hover:opacity-100" title="close" onclick={onclose}>x</button>
    </div>

    {#if err}
      <div class="text-red-400">{err}</div>
    {:else if data && data.editions.length === 0}
      <div class="opacity-70">No chapters in this file.</div>
    {:else if data}
      <label class="flex items-center gap-2 text-xs opacity-80">
        <input type="checkbox" bind:checked={showHidden} /> show hidden splice atoms
      </label>

      {#each data.editions as ed, i (i)}
        <div class="rounded border border-primary-border/20">
          <button class="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-primary/5" onclick={() => toggle(i)}>
            <span class="opacity-60">{expanded[i] ? '-' : '+'}</span>
            <span class="font-semibold">{ed.label}</span>
            {#if ed.default}<span class="rounded bg-primary/20 px-1 text-[10px] uppercase">default</span>{/if}
            {#if ed.ordered}<span class="text-[10px] opacity-60">ordered</span>{/if}
            {#if ed.ordered && ed.playedNs > 0}<span class="text-xs opacity-70">{fmtDuration(ed.playedNs)}</span>{/if}
            <span class="ml-auto text-xs opacity-60">{ed.visibleCount} chapters</span>
          </button>

          {#if expanded[i]}
            <ul class="max-h-72 overflow-auto border-t border-primary-border/15 px-2 py-1 font-mono text-xs">
              {#each ed.chapters as c, j (j)}
                {#if !c.hidden}
                  <li class="flex gap-3">
                    <span class="w-6 text-right opacity-50">{ed.chapters.slice(0, j + 1).filter((x) => !x.hidden).length}</span>
                    <span class="tabular-nums opacity-80">{fmtDuration(c.startNs)}</span>
                    <span class="truncate">{c.title}</span>
                  </li>
                {:else if showHidden}
                  <li class="flex gap-3 opacity-40">
                    <span class="w-6 text-right">.</span>
                    <span class="tabular-nums">{fmtDuration(c.startNs)}</span>
                    <span>(join)</span>
                  </li>
                {/if}
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    {/if}

    <div class="mt-1 flex justify-end">
      <button class="rounded border border-primary-border/25 px-3 py-1 hover:bg-primary/10" onclick={onclose}>Close</button>
    </div>
  </div>
</div>
