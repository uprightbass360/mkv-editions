<script lang="ts">
  let { scanning, canSave, onOpenFolder, onOpenZip, onOpenIso, onOpenProject, onSaveProject }: {
    scanning: boolean
    canSave: boolean
    onOpenFolder: () => void
    onOpenZip: () => void
    onOpenIso: () => void
    onOpenProject: () => void
    onSaveProject: () => void
  } = $props()

  let open = $state(false)

  function choose(fn: () => void) { open = false; fn() }

  function onDocClick() { open = false }
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') open = false }

  $effect(() => {
    if (!open) return
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  })
</script>

<div class="relative">
  <button class="rounded border border-primary-border/25 px-3 py-1 hover:bg-primary/10" onclick={(e) => { e.stopPropagation(); open = !open }}>File</button>
  {#if open}
    <div class="absolute left-0 z-40 mt-1 flex w-44 flex-col rounded border border-primary-border/25 bg-surface py-1 text-sm shadow-lg dark:bg-surface-dark" role="menu">
      <button class="px-3 py-1 text-left hover:bg-primary/10 disabled:opacity-50" role="menuitem" disabled={scanning} onclick={() => choose(onOpenFolder)}>Open folder...</button>
      <button class="px-3 py-1 text-left hover:bg-primary/10 disabled:opacity-50" role="menuitem" disabled={scanning} onclick={() => choose(onOpenZip)}>Open ZIP...</button>
      <button class="px-3 py-1 text-left hover:bg-primary/10" role="menuitem" onclick={() => choose(onOpenIso)}>Open ISO...</button>
      <button class="px-3 py-1 text-left hover:bg-primary/10" role="menuitem" onclick={() => choose(onOpenProject)}>Open project...</button>
      {#if canSave}
        <button class="px-3 py-1 text-left hover:bg-primary/10" role="menuitem" onclick={() => choose(onSaveProject)}>Save project...</button>
      {/if}
    </div>
  {/if}
</div>
