import type { Email, Me, Sender } from "@/types";

export const mockMe: Me = {
  id: "u_1",
  name: "Oliver Brown",
  email: "oliver.brown@domain.io",
  avatarUrl: "https://i.pravatar.cc/96?img=12",
};

export const mockSenders: Sender[] = [
  { id: "s_1", email: "oliver.brown@domain.io" },
  { id: "s_2", email: "outreach@domain.io" },
];

const people = [
  "John Smith", "Olive", "Amanda Clark", "Ramit Sethi", "Priya Nair", "Lucas Meyer",
  "Sofia Rossi", "Chen Wei", "Grace Kim", "Noah Patel", "Emma Davis", "Liam Turner",
];
const subjects = [
  "Meeting follow-up", "Ramit, great to meet you - you'll love it", "Quick question about Q4",
  "Your demo is ready", "Proposal for next week", "Checking in", "Thanks for your time",
  "Invitation: product walkthrough", "Re: pricing details", "Partnership idea",
];

function body(name: string, subject: string): string {
  const first = name.split(" ")[0];
  return `<p>Hi ${first},</p><p>Just wanted to follow up on our meeting about <strong>${subject.toLowerCase()}</strong>. Let me know a good time to connect this week.</p><blockquote>Reply to this email and I'll send over the details.</blockquote><p>Best,<br/>Oliver</p>`;
}

function build(i: number, kind: "scheduled" | "sent"): Email {
  const name = people[i % people.length]!;
  const subject = subjects[i % subjects.length]!;
  const html = body(name, subject);
  const hour = 3600_000;
  const now = Date.now();
  const failed = kind === "sent" && i % 9 === 4;
  const scheduledAt = new Date(kind === "scheduled" ? now + (i + 1) * 5 * hour : now - (i + 1) * 3 * hour).toISOString();
  return {
    id: `${kind}_${i + 1}`,
    to: name,
    subject,
    bodyPreview: `Hi ${name.split(" ")[0]}, just wanted to follow up on our meeting...`,
    bodyHtml: html,
    status: kind === "scheduled" ? (i === 0 ? "sending" : "scheduled") : failed ? "failed" : "sent",
    scheduledAt,
    sentAt: kind === "sent" && !failed ? scheduledAt : null,
    senderEmail: mockSenders[i % 2]!.email,
    error: failed ? "Recipient mailbox unavailable" : null,
    previewUrl: kind === "sent" && !failed ? "https://ethereal.email/messages" : null,
    ...(i % 4 === 0
      ? {
          attachments: [
            { name: "Tennis_Coach_Profile.png", size: "1.2 MB", url: `https://picsum.photos/seed/onb${i}a/420/240` },
            { name: "Tennis_Coach_Profile2.png", size: "1.2 MB", url: `https://picsum.photos/seed/onb${i}b/420/240` },
          ],
        }
      : {}),
  };
}

export const mockEmails: Email[] = [
  ...Array.from({ length: 34 }, (_, i) => build(i, "scheduled")),
  ...Array.from({ length: 42 }, (_, i) => build(i, "sent")),
];
