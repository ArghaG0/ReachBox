import { createFileRoute } from "@tanstack/react-router";
import { MailPage } from "@/components/layout/MailPage";

export const Route = createFileRoute("/_authenticated/sent")({
  head: () => ({
    meta: [
      { title: "Sent — ONB" },
      { name: "description", content: "Emails delivered (or failed) by your ONB scheduler." },
      { property: "og:title", content: "Sent — ONB" },
      { property: "og:description", content: "Emails delivered (or failed) by your ONB scheduler." },
    ],
  }),
  component: () => <MailPage status="sent" />,
});
