import { createFileRoute } from "@tanstack/react-router";
import { MailPage } from "@/components/layout/MailPage";

export const Route = createFileRoute("/_authenticated/scheduled")({
  head: () => ({
    meta: [
      { title: "Scheduled — ONB" },
      { name: "description", content: "Emails queued to go out from your ONB scheduler." },
      { property: "og:title", content: "Scheduled — ONB" },
      { property: "og:description", content: "Emails queued to go out from your ONB scheduler." },
    ],
  }),
  component: () => <MailPage status="scheduled" />,
});
