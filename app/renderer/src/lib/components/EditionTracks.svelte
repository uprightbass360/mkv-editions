<script lang="ts">
  import type { Project } from '$lib/project'
  let { project, shared, onappend, onremove, onrename, onadd }: {
    project: Project; shared: Set<string>
    onappend: (editionIdx: number, clipId: string) => void
    onremove: (editionIdx: number, clipIdx: number) => void
    onrename: (editionIdx: number, name: string) => void
    onadd: () => void
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
      class="rounded-md border border-dashed border-slate-600 p-1.5"
      ondrop={(e) => onDrop(e, i)}
      ondragover={(e) => e.preventDefault()}
    >
      <input class="mb-1 bg-transparent font-semibold" value={ed.name} onchange={(e) => onrename(i, (e.target as HTMLInputElement).value)} />
      <div class="flex min-h-6 flex-wrap gap-1">
        {#each ed.clips as c, k (k)}
          <span class="rounded border px-1 text-xs {shared.has(c) ? 'border-indigo-400 bg-indigo-500/20' : 'border-slate-600'}">
            {c}
            <button class="opacity-60" onclick={() => onremove(i, k)}>x</button>
          </span>
        {/each}
      </div>
    </div>
  {/each}
  <button class="self-start rounded bg-slate-700 px-2 py-1 text-sm" onclick={() => onadd()}>+ new edition</button>
</div>
