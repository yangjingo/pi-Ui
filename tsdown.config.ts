import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-aida', ['lib/types/index.js', 'lib/types/invariant.js'], {
  // The client-modules loader cannot require emitted chunks, so the lazy
  // mermaid import must inline into client.js (the chunk file is served but
  // never registered in the module table).
  client: {
    outputOptions: {
      inlineDynamicImports: true,
    },
  },
})
