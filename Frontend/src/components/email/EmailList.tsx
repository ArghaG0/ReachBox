import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useEmails } from "@/hooks/use-emails";
import type { ListStatus } from "@/types";
import { EmailRow } from "./EmailRow";
import { EmptyState } from "./EmptyState";

function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 border-b border-border px-6 py-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-5 w-28 rounded-full" />
      <Skeleton className="h-4 flex-1" />
    </div>
  );
}

export function EmailList({ status, q }: { status: ListStatus; q: string }) {
  const query = useEmails(status, q);

  if (query.isPending) {
    return <div>{Array.from({ length: 8 }, (_, i) => <RowSkeleton key={i} />)}</div>;
  }

  if (query.isError) {
    return (
      <EmptyState icon={AlertCircle} title="Couldn't load emails">
        <p className="text-sm text-muted-foreground">{query.error.message}</p>
        <Button variant="brand-outline" size="sm" onClick={() => query.refetch()}>
          Retry
        </Button>
      </EmptyState>
    );
  }

  const items = query.data.pages.flatMap((p) => p.items);
  if (items.length === 0) {
    return (
      <EmptyState icon={Inbox} title={status === "scheduled" ? "No scheduled emails" : "No sent emails"}>
        {q && <p className="text-sm text-muted-foreground">Nothing matches "{q}"</p>}
      </EmptyState>
    );
  }

  return (
    <div>
      {items.map((e) => <EmailRow key={e.id} email={e} />)}
      {query.hasNextPage && (
        <div className="flex justify-center py-6">
          <Button variant="brand-outline" size="sm" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage && <Loader2 className="animate-spin" />}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
