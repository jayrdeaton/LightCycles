import { HeroTitleTrails, HeroTitleTrailsProps } from './HeroTitleTrails'

// Trivial passthrough on native — see HeroTitleTrailsHost.web.tsx / GameBoardHost.web.tsx for why
// web needs an actual lazy-loading wrapper here; native genuinely doesn't.
export default function HeroTitleTrailsHost(props: HeroTitleTrailsProps) {
  return <HeroTitleTrails {...props} />
}
