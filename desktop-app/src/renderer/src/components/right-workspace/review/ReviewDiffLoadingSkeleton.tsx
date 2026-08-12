import { Skeleton } from '@/components/ui/skeleton'

const skeletonLineWidths = ['w-5/6', 'w-3/5', 'w-2/3', 'w-4/5', 'w-1/2', 'w-3/4']

export function ReviewDiffLoadingSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-label="正在加载差异">
      <span className="sr-only">正在加载差异</span>
      <div aria-hidden className="space-y-1">
        {skeletonLineWidths.map((widthClassName) => (
          <div key={widthClassName} className="grid h-5 grid-cols-[2.75rem_1fr]">
            <Skeleton className="h-full rounded-sm" />
            <Skeleton className={`my-1.5 ml-3 h-2 ${widthClassName}`} />
          </div>
        ))}
      </div>
    </div>
  )
}
