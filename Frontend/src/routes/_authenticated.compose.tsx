import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RecipientInput } from "@/components/email/RecipientInput";
import { SendLaterPopover } from "@/components/email/SendLaterPopover";
import { AttachmentCard } from "@/components/email/AttachmentCard";
import { RichTextEditor } from "@/components/email/RichTextEditor";
import { api } from "@/lib/api";
import { keys, useSenders } from "@/hooks/use-emails";

export const Route = createFileRoute("/_authenticated/compose")({
  head: () => ({
    meta: [
      { title: "Compose — ONB" },
      { name: "description", content: "Write and schedule a new email campaign with ONB." },
      { property: "og:title", content: "Compose — ONB" },
      { property: "og:description", content: "Write and schedule a new email campaign with ONB." },
    ],
  }),
  component: ComposePage,
});

type Errors = Partial<Record<"sender" | "to" | "subject" | "body" | "delay" | "hourly", string>>;

const Err = ({ msg }: { msg?: string | undefined }) => (msg ? <p className="mt-1 text-xs text-destructive">{msg}</p> : null);

function Row({ label, children, error }: { label: string; children: ReactNode; error?: string | undefined }) {
  return (
    <div className="flex items-start gap-4">
      <span className="w-14 shrink-0 pt-3 text-sm text-foreground">{label}</span>
      <div className="flex-1">
        {children}
        <Err msg={error} />
      </div>
    </div>
  );
}

const numCls = "h-10 w-[70px] rounded-md border border-border bg-background px-2.5 text-[15px] outline-none placeholder:text-muted-foreground/60 focus:border-brand";

function ComposePage() {
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const senders = useSenders();

  const [senderId, setSenderId] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [bodyEmpty, setBodyEmpty] = useState(true);
  const [delay, setDelay] = useState("");
  const [hourly, setHourly] = useState("");
  const [sendAt, setSendAt] = useState<Date | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [files, setFiles] = useState<{ id: string; name: string; size: string; url: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = Array.from(list).map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      size: f.size > 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`,
      url: f.type.startsWith("image/") ? URL.createObjectURL(f) : "",
    }));
    setFiles((prev) => [...prev, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };

  useEffect(() => {
    if (!senderId && senders.data?.length) setSenderId(senders.data[0]!.id);
  }, [senders.data, senderId]);

  useEffect(() => {
    if (senders.isError) toast.error(`Couldn't load senders: ${senders.error.message}`);
  }, [senders.isError, senders.error]);

  const schedule = useMutation({
    mutationFn: api.schedule,
    onSuccess: (res) => {
      toast.success(`${res.total} emails scheduled`);
      qc.invalidateQueries({ queryKey: keys.emails });
      navigate({ to: "/scheduled" });
    },
    onError: (e) => toast.error(e.message || "Failed to schedule emails"),
  });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const delaySeconds = delay === "" ? 0 : Number(delay);
    const hourlyLimit = Number(hourly);
    const next: Errors = {};
    if (!senderId) next.sender = "Select a sender";
    if (!recipients.length) next.to = "Add at least one recipient";
    if (!subject.trim()) next.subject = "Subject is required";
    if (bodyEmpty) next.body = "Email body can't be empty";
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0) next.delay = "Delay must be 0 or more";
    if (!Number.isFinite(hourlyLimit) || hourlyLimit < 1) next.hourly = "Hourly limit must be at least 1";
    if (sendAt && sendAt.getTime() < Date.now()) {
      toast.error("Scheduled time is in the past");
      return setErrors(next);
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    schedule.mutate({
      senderId,
      subject: subject.trim(),
      bodyHtml,
      recipients,
      startAt: sendAt ? sendAt.toISOString() : null,
      delaySeconds,
      hourlyLimit,
    });
  };

  return (
    <form onSubmit={submit} className="min-h-screen bg-background">
      <header className="flex items-center gap-3 px-4 py-4">
        <button
          type="button"
          aria-label="Back"
          onClick={() => (window.history.length > 1 ? router.history.back() : navigate({ to: "/scheduled" }))}
          className="rounded-full p-1 hover:bg-field"
        >
          <ArrowLeft className="size-6" />
        </button>
        <h1 className="flex-1 text-2xl text-foreground">Compose New Email</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Attach"
            onClick={() => fileRef.current?.click()}
            className={`relative rounded-full p-1.5 hover:bg-field ${files.length ? "text-brand" : "text-muted-foreground"}`}
          >
            <Paperclip className="size-5" />
            {files.length > 0 && (
              <span className="absolute bottom-0 right-0 flex size-3.5 items-center justify-center rounded-full bg-field text-[9px] text-foreground">
                {files.length}
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          <SendLaterPopover value={sendAt} onChange={setSendAt} />
          <Button type="submit" variant="brand-outline" className="ml-2 h-[34px] min-w-[100px]" disabled={schedule.isPending}>
            {schedule.isPending && <Loader2 className="animate-spin" />}
            {sendAt ? "Send Later" : "Send"}
          </Button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1040px] flex-col gap-4 px-6 pb-12 pt-4">
        <Row label="From" error={errors.sender}>
          <div className="relative inline-flex">
            <select
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              disabled={senders.isPending}
              className="h-10 cursor-pointer appearance-none rounded-md bg-field py-2 pl-2.5 pr-9 text-[15px] text-foreground outline-none"
            >
              {senders.isPending && <option>Loading…</option>}
              {senders.data?.map((s) => <option key={s.id} value={s.id}>{s.email}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-3 size-4 text-muted-foreground" />
          </div>
        </Row>

        <Row label="To" error={errors.to}>
          <RecipientInput value={recipients} onChange={setRecipients} />
        </Row>

        <Row label="Subject" error={errors.subject}>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="h-11 w-full border-b border-border bg-transparent px-2 text-[15px] outline-none placeholder:text-muted-foreground focus:border-brand"
          />
        </Row>

        <div className="flex flex-wrap items-start gap-8">
          <div>
            <label className="flex items-center gap-4 text-sm text-foreground">
              Delay between 2 emails
              <input type="number" min={0} value={delay} onChange={(e) => setDelay(e.target.value)} placeholder="00" className={numCls} />
            </label>
            <Err msg={errors.delay} />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              Hourly Limit
              <input type="number" min={1} value={hourly} onChange={(e) => setHourly(e.target.value)} placeholder="00" className={numCls} />
            </label>
            <Err msg={errors.hourly} />
          </div>
        </div>

        <div>
          <RichTextEditor
            onChange={(html, empty) => {
              setBodyHtml(html);
              setBodyEmpty(empty);
            }}
          />
          <Err msg={errors.body} />
        </div>

        {files.length > 0 && (
          <div className="flex flex-wrap gap-4">
            {files.map((f) =>
              f.url ? (
                <AttachmentCard key={f.id} name={f.name} size={f.size} url={f.url} onRemove={() => setFiles((p) => p.filter((x) => x.id !== f.id))} />
              ) : (
                <div key={f.id} className="group flex items-center gap-2 rounded-lg bg-field px-3 py-2 text-sm">
                  <Paperclip className="size-4 text-muted-foreground" /> {f.name} <span className="text-xs text-muted-foreground">{f.size}</span>
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))} className="text-muted-foreground hover:text-foreground">×</button>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </form>
  );
}
