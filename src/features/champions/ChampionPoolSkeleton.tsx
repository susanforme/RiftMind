import { Skeleton } from '../../components/ui/skeleton';

export function ChampionChartSkeleton() {
  return (
    <div className="grid h-56 grid-rows-6 gap-2 py-1" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-4">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 flex-1" />
        </div>
      ))}
    </div>
  );
}

export function ChampionTableSkeleton() {
  return (
    <div data-ui="champion-table-loading" className="min-h-[328px]" aria-hidden="true">
      <Skeleton className="h-10 w-full rounded-none" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex h-12 items-center gap-4 border-b px-4">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ms-auto h-4 w-12" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="hidden h-4 w-16 md:block" />
        </div>
      ))}
    </div>
  );
}
