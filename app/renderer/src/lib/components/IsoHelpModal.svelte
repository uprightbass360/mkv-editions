<script lang="ts">
  let { onclose }: { onclose: () => void } = $props()
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onclose() }
  $effect(() => {
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
  <div class="w-[520px] max-w-full rounded-lg border border-primary-border/30 bg-surface p-4 text-sm dark:bg-surface-dark" role="dialog" aria-modal="true">
    <div class="mb-2 flex items-center justify-between">
      <h2 class="text-base font-semibold">Open ISO</h2>
      <button class="opacity-60 hover:opacity-100" title="close" onclick={onclose}>x</button>
    </div>
    <p>Mount the ISO first, then use "Open folder..." on the mount point:</p>
    <pre class="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-page p-2 dark:bg-page-dark">sudo mount -o loop,ro your-disc.iso /mnt/disc
# or rootless (Linux desktop):
udisksctl loop-setup -f your-disc.iso</pre>
    <div class="mt-3 flex justify-end">
      <button class="rounded border border-primary-border/25 px-3 py-1 hover:bg-primary/10" onclick={onclose}>Close</button>
    </div>
  </div>
</div>
