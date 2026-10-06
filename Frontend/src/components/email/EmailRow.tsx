import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Email } from "@/types";
import { StatusBadge } from "./StatusBadge";

export function EmailRow({ email }: { email: Email }) {
  const [starred, setStarred] = useState(false);
  return (
    <Link
      to="/email/$id"
      params={{ id: email.id }}
      className="flex items-center gap-4 border-b border-border px-6 py-4 text-sm transition-colors hover:bg-field/70"
    >
      <span className="w-48 shrink-0 truncate text-foreground">To: {email.to}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <StatusBadge email={email} />
        <p className="truncate">
          <span className="font-medium text-foreground">{email.subject}</span>
          <span className="text-muted-foreground"> - {email.bodyPreview}</span>
        </p>
      </div>
      <button
        type="button"
        aria-label={starred ? "Unstar" : "Star"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setStarred((s) => !s);
        }}
        className="shrink-0 text-muted-foreground/60 hover:text-warning"
      >
        <Star className={cn("size-4", starred && "fill-warning text-warning")} />
      </button>
    </Link>
  );
}
