import { Clock } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Email } from "@/types";

export function StatusBadge({ email }: { email: Pick<Email, "status" | "scheduledAt"> }) {
  const base = "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";
  if (email.status === "scheduled" || email.status === "sending") {
    return (
      <span className={cn(base, "border border-warning/40 bg-warning-soft text-warning")}>
        <Clock className="size-3" />
        {email.status === "sending" ? "Sending" : format(new Date(email.scheduledAt), "EEE h:mm:ss a")}
      </span>
    );
  }
  if (email.status === "failed") {
    return <span className={cn(base, "bg-danger-soft text-destructive")}>Failed</span>;
  }
  return <span className={cn(base, "bg-field text-muted-foreground")}>Sent</span>;
}
