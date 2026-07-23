import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['electron/main.ts', 'electron/preload.ts'],
  format: ['cjs'],
  outDir: 'dist-electron',
  target: 'node18',
  platform: 'node',
  clean: true,
  sourcemap: true,
  external: ['electron']
})
