<script lang="ts">
  let result = $state<string | null>(null)
  async function handlePing() { result = await window.api.ping() }
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 text-white">
  <h1 class="text-2xl font-bold">mkv-editions workbench</h1>
  <button class="rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500" onclick={handlePing}>Ping main process</button>
  {#if result}<p data-testid="result">Result: {result}</p>{/if}
</main>
