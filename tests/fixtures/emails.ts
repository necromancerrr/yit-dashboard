import type { NormalizedMessage } from "@/lib/ingest/types";
import type { ApplicationStatus } from "@/lib/types";

/**
 * Realistic recruiting mail, in the shape the pipeline actually receives.
 *
 * These are paraphrased from the templates the big ATS platforms send, kept
 * close enough in wording that the deterministic rules are tested against
 * language they will really meet — and deliberately including the awkward
 * cases (forwards, reminders, job alerts, two roles at one company) rather
 * than only the ones that classify cleanly.
 */

export interface EmailFixture {
  name: string;
  message: NormalizedMessage;
  expect: {
    careerRelated: boolean;
    /** null means the rules are expected to defer to the AI provider. */
    status: ApplicationStatus | null;
    company?: string | null;
    deadline?: string | null;
    /** True when rules should return null rather than guess. */
    deferToAI?: boolean;
  };
}

function msg(over: Partial<NormalizedMessage> & { providerMessageId: string }): NormalizedMessage {
  return {
    threadId: `t-${over.providerMessageId}`,
    receivedOn: "2026-08-20",
    subject: "",
    senderName: null,
    senderEmail: null,
    snippet: "",
    ...over,
  };
}

export const EMAIL_FIXTURES: EmailFixture[] = [
  {
    name: "application confirmation from a corporate domain",
    message: msg({
      providerMessageId: "gs-001",
      subject: "Thank you for applying to Goldman Sachs",
      senderName: "Goldman Sachs Recruiting",
      senderEmail: "no-reply@goldmansachs.com",
      snippet:
        "Thank you for your interest in Goldman Sachs. We have received your application for the 2026 Summer Analyst Programme and our team will review it shortly.",
    }),
    expect: { careerRelated: true, status: "Applied", company: "goldmansachs" },
  },
  {
    name: "online assessment invite with an explicit deadline",
    message: msg({
      providerMessageId: "hr-002",
      subject: "Your HackerRank test for Goldman Sachs is ready",
      senderName: "HackerRank",
      senderEmail: "noreply@hackerrank.com",
      snippet:
        "You have been invited to complete an online assessment for your application to Goldman Sachs. The assessment is due by August 24, 2026.",
    }),
    expect: { careerRelated: true, status: "OA", deadline: "2026-08-24" },
  },
  {
    name: "OA reminder — same situation, different message",
    message: msg({
      providerMessageId: "hr-003",
      threadId: "t-hr-002",
      receivedOn: "2026-08-22",
      subject: "Reminder: your HackerRank test for Goldman Sachs expires soon",
      senderName: "HackerRank",
      senderEmail: "noreply@hackerrank.com",
      snippet:
        "This is a reminder that your online assessment for Goldman Sachs is still outstanding. The coding challenge expires on August 24, 2026.",
    }),
    expect: { careerRelated: true, status: "OA", deadline: "2026-08-24" },
  },
  {
    name: "recruiter screen invitation",
    message: msg({
      providerMessageId: "amz-004",
      subject: "Amazon - scheduling an introductory call",
      senderName: "Amazon Recruiting",
      senderEmail: "recruiting@amazon.com",
      snippet:
        "Thanks for your patience. I would love to set up a recruiter call to discuss the SDE Intern role and walk you through the process.",
    }),
    expect: { careerRelated: true, status: "Phone Screen", company: "amazon" },
  },
  {
    name: "technical interview invitation",
    message: msg({
      providerMessageId: "strp-005",
      subject: "Next steps: technical interview with Stripe",
      senderName: "Stripe Talent",
      senderEmail: "talent@stripe.com",
      snippet:
        "We would like to invite you to a technical interview. The session lasts 60 minutes and focuses on practical coding.",
    }),
    expect: { careerRelated: true, status: "Technical", company: "stripe" },
  },
  {
    name: "final round beats the 'thanks for applying' boilerplate below it",
    message: msg({
      providerMessageId: "gs-006",
      subject: "Goldman Sachs superday invitation",
      senderName: "Goldman Sachs Recruiting",
      senderEmail: "campus@goldmansachs.com",
      snippet:
        "Thank you for applying. We are pleased to invite you to our final round superday on September 3.",
    }),
    expect: { careerRelated: true, status: "Onsite" },
  },
  {
    name: "offer",
    message: msg({
      providerMessageId: "strp-007",
      subject: "Your offer from Stripe",
      senderName: "Stripe Talent",
      senderEmail: "talent@stripe.com",
      snippet: "We are pleased to offer you the Software Engineer Intern position for summer 2026.",
    }),
    expect: { careerRelated: true, status: "Offer", company: "stripe" },
  },
  {
    name: "rejection outranks the interview vocabulary around it",
    message: msg({
      providerMessageId: "amz-008",
      subject: "Update on your Amazon application",
      senderName: "Amazon Recruiting",
      senderEmail: "recruiting@amazon.com",
      snippet:
        "After careful consideration following your technical interview, unfortunately we will not be moving forward with your application at this time.",
    }),
    expect: { careerRelated: true, status: "Rejected", company: "amazon" },
  },
  {
    name: "forwarded confirmation still classifies",
    message: msg({
      providerMessageId: "fwd-009",
      subject: "Fwd: Re: Fwd: Thank you for applying to Goldman Sachs",
      senderName: "Yit",
      senderEmail: "yejigu@uw.edu",
      snippet: "Thank you for your interest in Goldman Sachs. We have received your application.",
    }),
    expect: { careerRelated: true, status: "Applied" },
  },
  {
    name: "job alert is not about an application of yours",
    message: msg({
      providerMessageId: "alert-010",
      subject: "10 new jobs matching your search",
      senderName: "LinkedIn Job Alerts",
      senderEmail: "jobs-noreply@linkedin.com",
      snippet:
        "New jobs you may be interested in: Software Engineer at Meta, Backend Engineer at Datadog. Apply now to be considered.",
    }),
    expect: { careerRelated: false, status: null },
  },
  {
    name: "newsletter is not recruiting mail",
    message: msg({
      providerMessageId: "news-011",
      subject: "Your weekly digest from Handshake",
      senderName: "Handshake",
      senderEmail: "no-reply@joinhandshake.com",
      snippet: "This week's career fair line-up and a webinar on resume writing. Unsubscribe from job alerts.",
    }),
    expect: { careerRelated: false, status: null },
  },
  {
    name: "free-form recruiter prose defers to the AI provider",
    message: msg({
      providerMessageId: "vague-012",
      subject: "Following up",
      senderName: "Dana Whitfield",
      senderEmail: "dana@datadoghq.com",
      snippet:
        "Great chatting earlier — the team really enjoyed it and wants to keep things moving. I'll be in touch with details shortly.",
    }),
    expect: { careerRelated: true, status: null, deferToAI: true },
  },
  {
    name: "relative deadline resolves against the received date",
    message: msg({
      providerMessageId: "cod-013",
      receivedOn: "2026-08-20",
      subject: "Codility assessment for your application to Ramp",
      senderName: "Codility",
      senderEmail: "no-reply@codility.com",
      snippet: "Please complete the coding challenge within 5 days of receiving this email.",
    }),
    expect: { careerRelated: true, status: "OA", deadline: "2026-08-25" },
  },
];
