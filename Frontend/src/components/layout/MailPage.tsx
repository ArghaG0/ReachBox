import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Filter, RotateCw, Search } from "lucide-react";
import { EmailList } from "@/components/email/EmailList";
import { useDebounce } from "@/hooks/use-debounce";
import { keys, useMe } from "@/hooks/use-emails";
import { cn } from "@/lib/utils";
import type { ListStatus } from "@/types";
import { Sidebar } from "./Sidebar";

export function MailPage({ status }: { status: ListStatus }) {
  const me = useMe();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const q = useDebounce(search, 300);
  const [spinning, setSpinning] = useState(false);

  const refresh = async () => {
    setSpinning(true);
    await qc.invalidateQueries({ queryKey: keys.emails });
    setSpinning(false);
  };

  if (!me.data) return null;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar me={me.data} />
      <main className="min-w-0 flex-1 pr-4">
        <div className="flex items-center gap-4 py-4 pl-8">
          <label className="flex h-[38px] max-w-[672px] flex-1 items-center gap-2 rounded-full bg-field px-4">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <button type="button" aria-label="Filter" className="rounded-full p-2 text-muted-foreground hover:bg-field">
            <Filter className="size-4" />
          </button>
          <button type="button" aria-label="Refresh" onClick={refresh} className="rounded-full p-2 text-muted-foreground hover:bg-field">
            <RotateCw className={cn("size-4", spinning && "animate-spin")} />
          </button>
        </div>
        <div className="pl-8">
          <EmailList status={status} q={q} />
        </div>
      </main>
    </div>
  );
}
