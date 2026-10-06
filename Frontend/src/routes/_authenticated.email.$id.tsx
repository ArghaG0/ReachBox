import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AttachmentCard } from "@/components/email/AttachmentCard";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import DOMPurify from "dompurify";
import { format } from "date-fns";
import { AlertCircle, Archive, ArrowLeft, ChevronDown, ExternalLink, Star, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/email/StatusBadge";
import { EmptyState } from "@/components/email/EmptyState";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { useEmail, useMe } from "@/hooks/use-emails";

export const Route = createFileRoute("/_authenticated/email/$id")({
  head: () => ({
    meta: [
      { title: "Email — ONB" },
      { name: "description", content: "View the details of a scheduled or sent email." },
      { property: "og:title", content: "Email — ONB" },
      { property: "og:description", content: "View the details of a scheduled or sent email." },
    ],
  }),
  component: EmailDetail,
});

function EmailDetail() {
  const { id } = Route.useParams();
  const router = useRouter();
  const me = useMe();
  const email = useEmail(id);
  const html = useMemo(() => (email.data ? DOMPurify.sanitize(email.data.bodyHtml) : ""), [email.data]);
  const back = () => (window.history.length > 1 ? router.history.back() : router.navigate({ to: "/scheduled" }));
  const [starred, setStarred] = useState(false);
  const soon = () => toast("Coming soon");
  const iconBtn = "rounded-full p-1.5 text-muted-foreground/70 hover:bg-field";

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 px-4 py-4">
        <button type="button" aria-label="Back" onClick={back} className="rounded-full p-1 hover:bg-field">
          <ArrowLeft className="size-6" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-2xl text-foreground">
          {email.data ? email.data.subject : <Skeleton className="h-7 w-80" />}
        </h1>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Star" aria-pressed={starred} onClick={() => setStarred((v) => !v)} className={iconBtn}>
            <Star className={starred ? "size-5 fill-warning text-warning" : "size-5"} />
          </button>
          <button type="button" aria-label="Archive" onClick={soon} className={iconBtn}><Archive className="size-5" /></button>
          <button type="button" aria-label="Delete" onClick={soon} className={iconBtn}><Trash2 className="size-5" /></button>
          <span className="mx-3 h-8 w-px bg-border" />
          {me.data && <UserAvatar me={me.data} />}
        </div>
      </header>

      <div className="mx-auto max-w-[1040px] px-6 py-4">
        {email.isPending ? (
          <div className="flex gap-4">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-6 h-40 w-full" />
            </div>
          </div>
        ) : email.isError ? (
          <EmptyState icon={AlertCircle} title="Couldn't load this email">
            <p className="text-sm text-muted-foreground">{email.error.message}</p>
            <div className="flex gap-2">
              <Button variant="brand-outline" size="sm" onClick={() => email.refetch()}>Retry</Button>
              <Button variant="ghost" size="sm" onClick={back}>Back</Button>
            </div>
          </EmptyState>
        ) : (
          <article className="flex gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-primary-foreground">
              {(email.data.senderEmail[0] ?? "?").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[15px] font-semibold text-foreground">
                    {email.data.senderEmail}
                  </p>
                  <p className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground">to {email.data.to} <ChevronDown className="size-3.5" /></p>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <StatusBadge email={email.data} />
                  {format(new Date(email.data.sentAt ?? email.data.scheduledAt), "MMM d, h:mm a")}
                </div>
              </div>
              {email.data.error && (
                <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-destructive">{email.data.error}</p>
              )}
              <div className="email-body mt-6 text-[15px] leading-relaxed text-foreground" dangerouslySetInnerHTML={{ __html: html }} />
              {email.data.attachments && email.data.attachments.length > 0 && (
                <div className="mt-6 flex flex-wrap gap-4">
                  {email.data.attachments.map((a) => <AttachmentCard key={a.url} name={a.name} size={a.size} url={a.url} />)}
                </div>
              )}
              {email.data.previewUrl && (
                <a href={email.data.previewUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm text-brand hover:underline">
                  Open Ethereal preview <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
