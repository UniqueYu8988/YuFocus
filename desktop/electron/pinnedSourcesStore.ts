import {
  normalizePinnedBilibiliSources,
  type PinnedBilibiliSource,
} from './sourceDiscovery'

type PinnedSourcesStoreDeps = {
  readPinnedSources: () => PinnedBilibiliSource[] | undefined
  writePinnedSources: (items: PinnedBilibiliSource[]) => void
}

export function createPinnedSourcesStore({
  readPinnedSources,
  writePinnedSources,
}: PinnedSourcesStoreDeps) {
  const loadPinnedSources = () => normalizePinnedBilibiliSources(readPinnedSources())

  const savePinnedSources = (items: unknown) => {
    const normalized = normalizePinnedBilibiliSources(items)
    writePinnedSources(normalized)
    return normalized
  }

  return {
    loadPinnedSources,
    savePinnedSources,
  }
}
