import { Card, CardContent } from '@/ui/components/base/card'
import { WorkbenchQueuePanel } from '@/ui/panels/workspace/WorkbenchQueueParts'
import {
  FollowSourceList,
  ManualSourceForm,
  SourceVideoList,
  WorkbenchToolbar,
} from '@/ui/panels/workspace/WorkbenchSourceParts'
import {
  type BilibiliFollowSource,
  type BilibiliSourceVideo,
  type MaterialInventoryRecord,
  type MaterialSourceMode,
  type PageSlice,
  type RuntimeSettingsFallback,
  type WorkbenchSourceItem,
  type WorkbenchSourceStatus,
} from '@/ui/panels/workspace/WorkbenchShared'

export function WorkbenchPaneContent({
  activeSource,
  activeSourceId,
  allSourceCount,
  filteredSourceCount,
  filteredSources,
  pagedSources,
  pinnedSourceIds,
  pinnedOnly,
  sourceQuery,
  sourcesLoading,
  sourcesError,
  sourcesMessage,
  sourceVideos,
  pagedSourceVideos,
  selectedVideoIds,
  sourceVideoMaxDurationSeconds,
  sourceVideoPage,
  sourceVideosFetchedAt,
  sourceVideosLoading,
  sourceVideosError,
  materialSourceMode,
  videoInput,
  manualSourceLoading,
  distillRequestState,
  distillProgressPercent,
  distillError,
  automationStatus,
  automationStatusLabel,
  automationLastCheckLabel,
  queueItems,
  pagedQueueItems,
  queuePageSize,
  canClearQueue,
  materialRootDir,
  runtimeSettings,
  editorialSummaryBuildingPath,
  onAddSelectedVideos,
  onPickLocalMedia,
  onTogglePinnedOnly,
  onRefreshSources,
  onSourceQueryChange,
  onSourcePageChange,
  onOpenSource,
  onTogglePinnedSource,
  onVideoInputChange,
  onMaterialSourceModeChange,
  onSubmitManualSource,
  onToggleVideo,
  onSourceVideoPageChange,
  onClearQueue,
  onOpenMaterialRoot,
  onRefreshMaterials,
  onQueuePageChange,
  getDurationBarPercent,
  formatRelativeTime,
  getItemStatus,
  getItemMeta,
  getItemTitle,
  canOpenBrief,
  getNotebookLmPathTitle,
  onRetryQueueItem,
  onCopyNotebookLmPath,
  onOpenBrief,
  onDeleteMaterial,
  onRemoveQueuedVideo,
}: {
  activeSource: BilibiliFollowSource | null
  activeSourceId: string
  allSourceCount: number
  filteredSourceCount: number
  filteredSources: BilibiliFollowSource[]
  pagedSources: PageSlice<BilibiliFollowSource>
  pinnedSourceIds: Set<string>
  pinnedOnly: boolean
  sourceQuery: string
  sourcesLoading: boolean
  sourcesError: string
  sourcesMessage?: string
  sourceVideos: BilibiliSourceVideo[]
  pagedSourceVideos: PageSlice<BilibiliSourceVideo>
  selectedVideoIds: string[]
  sourceVideoMaxDurationSeconds: number
  sourceVideoPage: number
  sourceVideosFetchedAt: number
  sourceVideosLoading: boolean
  sourceVideosError: string
  materialSourceMode: MaterialSourceMode
  videoInput: string
  manualSourceLoading: boolean
  distillRequestState: string
  distillProgressPercent: number
  distillError: string
  automationStatus: { running: boolean; paused: boolean; enabled: boolean } | null
  automationStatusLabel: string
  automationLastCheckLabel: string
  queueItems: WorkbenchSourceItem[]
  pagedQueueItems: PageSlice<WorkbenchSourceItem>
  queuePageSize: number
  canClearQueue: boolean
  materialRootDir: string
  runtimeSettings: RuntimeSettingsFallback
  editorialSummaryBuildingPath: string
  onAddSelectedVideos: () => void
  onPickLocalMedia: () => void
  onTogglePinnedOnly: () => void
  onRefreshSources: () => void
  onSourceQueryChange: (value: string) => void
  onSourcePageChange: (page: number) => void
  onOpenSource: (source: BilibiliFollowSource) => void
  onTogglePinnedSource: (source: BilibiliFollowSource) => void
  onVideoInputChange: (value: string) => void
  onMaterialSourceModeChange: (mode: MaterialSourceMode) => void
  onSubmitManualSource: () => void
  onToggleVideo: (bvid: string) => void
  onSourceVideoPageChange: (page: number) => void
  onClearQueue: () => void
  onOpenMaterialRoot: () => void
  onRefreshMaterials: () => void
  onQueuePageChange: (page: number) => void
  getDurationBarPercent: (durationSeconds: number, maxDurationSeconds: number) => number
  formatRelativeTime: (timestamp: number) => string
  getItemStatus: (item: WorkbenchSourceItem) => WorkbenchSourceStatus
  getItemMeta: (item: WorkbenchSourceItem) => string[]
  getItemTitle: (item: WorkbenchSourceItem) => string
  canOpenBrief: (record: MaterialInventoryRecord) => boolean
  getNotebookLmPathTitle: (record: MaterialInventoryRecord) => string
  onRetryQueueItem: (queueId: string) => void
  onCopyNotebookLmPath: (record: MaterialInventoryRecord) => void
  onOpenBrief: (record: MaterialInventoryRecord) => void
  onDeleteMaterial: (record: MaterialInventoryRecord) => void
  onRemoveQueuedVideo: (queueId: string) => void
}) {
  return (
    <div className="grid min-h-0 w-full grid-cols-1 gap-5">
      <section>
        <Card className="overflow-hidden rounded-[10px] border-white/[0.09] bg-[#1f1f1f] shadow-none">
          <CardContent className="space-y-3 p-4 pb-3">
            <WorkbenchToolbar
              activeSource={activeSource}
              filteredSourceCount={filteredSourceCount}
              sourcesLoading={sourcesLoading}
              distillRequestState={distillRequestState}
              distillProgressPercent={distillProgressPercent}
              automationStatus={automationStatus}
              automationStatusLabel={automationStatusLabel}
              automationLastCheckLabel={automationLastCheckLabel}
              selectedVideoCount={selectedVideoIds.length}
              pinnedOnly={pinnedOnly}
              sourceVideosLoading={sourceVideosLoading}
              onAddSelectedVideos={onAddSelectedVideos}
              onPickLocalMedia={onPickLocalMedia}
              onTogglePinnedOnly={onTogglePinnedOnly}
              onRefresh={onRefreshSources}
            />

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
              <FollowSourceList
                allSourceCount={allSourceCount}
                loading={sourcesLoading}
                filteredSources={filteredSources}
                pagedSources={pagedSources}
                pinnedSourceIds={pinnedSourceIds}
                activeSourceId={activeSourceId}
                pinnedOnly={pinnedOnly}
                query={sourceQuery}
                error={sourcesError}
                message={sourcesMessage}
                onQueryChange={onSourceQueryChange}
                onPageChange={onSourcePageChange}
                onOpenSource={onOpenSource}
                onTogglePinnedSource={onTogglePinnedSource}
              />

              <div className="min-w-0 space-y-2 border-l border-white/[0.055] pl-3">
                <ManualSourceForm
                  materialSourceMode={materialSourceMode}
                  videoInput={videoInput}
                  distillRequestState={distillRequestState}
                  manualSourceLoading={manualSourceLoading}
                  distillError={distillError}
                  onVideoInputChange={onVideoInputChange}
                  onMaterialSourceModeChange={onMaterialSourceModeChange}
                  onSubmit={onSubmitManualSource}
                />
                <SourceVideoList
                  activeSource={activeSource}
                  activeSourceId={activeSourceId}
                  videos={sourceVideos}
                  pagedVideos={pagedSourceVideos}
                  selectedVideoIds={selectedVideoIds}
                  maxDurationSeconds={sourceVideoMaxDurationSeconds}
                  sourceVideoPage={sourceVideoPage}
                  fetchedAt={sourceVideosFetchedAt}
                  loading={sourceVideosLoading}
                  error={sourceVideosError}
                  onToggleVideo={onToggleVideo}
                  onPageChange={onSourceVideoPageChange}
                  getDurationBarPercent={getDurationBarPercent}
                  formatRelativeTime={formatRelativeTime}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <WorkbenchQueuePanel
        items={queueItems}
        visibleItems={pagedQueueItems.items}
        canLoadMore={pagedQueueItems.page < pagedQueueItems.totalPages}
        distillRequestState={distillRequestState}
        editorialSummaryBuildingPath={editorialSummaryBuildingPath}
        onLoadMore={() => onQueuePageChange(pagedQueueItems.page + 1)}
        getItemStatus={getItemStatus}
        getItemMeta={getItemMeta}
        getItemTitle={getItemTitle}
        canOpenBrief={canOpenBrief}
        getNotebookLmPathTitle={getNotebookLmPathTitle}
        onRetryQueueItem={onRetryQueueItem}
        onCopyNotebookLmPath={onCopyNotebookLmPath}
        onOpenBrief={onOpenBrief}
      />
    </div>
  )
}
