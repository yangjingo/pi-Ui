declare module 'lucide-react/dist/esm/icons/*.mjs' {
  import type { ComponentType, SVGProps } from 'react'

  type LucideSubpathProps = SVGProps<SVGSVGElement> & {
    readonly size?: number | string
    readonly absoluteStrokeWidth?: boolean
  }

  const LucideIcon: ComponentType<LucideSubpathProps>
  export default LucideIcon
}
