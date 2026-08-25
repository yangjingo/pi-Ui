import { clientBundle } from '../tsdown.client.ts'
import type { UserConfig } from 'tsdown'

const bundle = clientBundle('@aida/aida-ui-dsh', ['lib/types/index.js', 'lib/types/invariant.js'])

export default (inlineConfig: Pick<UserConfig, 'env'>): UserConfig[] => bundle(inlineConfig).map(config => (
  config.name === '@aida/aida-ui-dsh/client'
    ? {
        ...config,
        // The client-modules loader cannot require emitted chunks, so the lazy
        // mermaid import must inline into client.js.
        outputOptions: { ...config.outputOptions, codeSplitting: false },
      }
    : config
))
