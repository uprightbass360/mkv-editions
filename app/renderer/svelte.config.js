import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ pages: 'build', assets: 'build', precompress: false, strict: true })
    // Do NOT set paths.relative or router.type:'hash'; the file: protocol
    // interception in electron/main.ts is what makes default root-absolute
    // asset paths + the pathname router work under file://.
  }
}

export default config
