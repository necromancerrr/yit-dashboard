import { db } from "@/lib/db";
import { applyEvent } from "@/lib/career";
import { getAIProvider } from "@/lib/ai";
import { classifyDeterministic, AUTO_APPLY_MIN_CONFIDENCE } from "@/lib/ingest/classify";
import { matchApplication, type MatchCandidate } from "@/lib/ingest/match";
import { classifyDomain, type DomainSignal } from "@/lib/ingest/domains";
import { companyFromDomain, senderDomain, truncateSnippet } from "@/lib/ingest/normalize";
import type { CareerSignal, IngestOutcome, NormalizedMessage } from "@/lib/ingest/types";
import type { ApplicationStatus } from "@/lib/types";

/**
 * Message in, proposal or applied event out.
 *
 * The pipeline is deliberately separate from any provider: it takes normalized
 * messages, so the whole path can be exercised against fixtures without a
 * network, an API key, or a mailbox. That is also why the hard cases live here
 * rather than in the Gmail client — duplicates, forwards, repeated reminders
 * and ambiguous matches are properties of *mail*, not of one vendor.
 *
 * Nothing here creates an application without confirmation. A message about a
 * company that is not in Career becomes an Inbox item carrying the proposed
 * company/status; confirming that item is the moment it becomes a row.
 */

/** How much of a mailbox one sync will look at. */
export const SYNC_BATCH_LIMIT = 50;

interface ProcessResult {
  outcome: "applied" | "proposed" | "ignored";
  detail: string;
  /** Set for non-career outcomes, so counters can tell them apart. */
  domain?: "school" | "money";
}

function displayCompany(signalCompany: string | null, message: NormalizedMessage): string | null {
  if (!signalCompany) return null;
  const domainGuess = companyFromDomain(senderDomain(message.senderEmail));
  const senderName = message.senderName?.trim();
  if (
    domainGuess === signalCompany &&
    senderName &&
    /^[\p{L}\p{N}&.' -]{2,60}$/u.test(senderName) &&
    !/\b(?:recruiting|talent|careers?|jobs?|team|notifications?|no-?reply)\b/i.test(senderName)
  ) {
    return senderName;
  }
  return signalCompany;
}

/**
 * Classify with rules first, and only escalate genuine gaps to the model.
 *
 * Rules answer most recruiting mail correctly and for free. A null from them
 * means "this needs judgement", which is exactly and only when a model earns
 * its round trip. A definite `isCareerRelated: false` is not escalated — the
 * rules are certain, and asking anyway would just spend money to agree.
 */
async function classify(message: NormalizedMessage): Promise<CareerSignal | null> {
  const deterministic = classifyDeterministic(message);
  if (deterministic) return deterministic;

  const provider = getAIProvider();
  if (!provider) return null;

  const result = await provider.classifyCareerEmail({
    subject: message.subject,
    sender: message.senderEmail ?? message.senderName ?? "unknown",
    snippet: message.snippet,
    receivedOn: message.receivedOn,
  });
  if (!result) return null;

  return {
    isCareerRelated: result.isCareerRelated,
    company: result.company,
    role: result.role,
    status: result.proposedStatus,
    // Deadlines are never taken from the classifier: extractCareerEvent is the
    // operation that reads dates, and an invented deadline would go straight
    // to the top of Today.
    deadline: null,
    confidence: result.confidence,
    method: "ai",
    reasoning: result.reasoning,
  };
}

async function raiseInboxItem(params: {
  kind: string;
  title: string;
  detail: string;
  severity: "info" | "attention" | "urgent";
  applicationId: number | null;
  externalEventId: number;
  proposedStatus: string | null;
  proposedCompany?: string | null;
  proposedRole?: string | null;
  proposedNextActionDate?: string | null;
  confidence: number;
  dedupeKey: string;
  domain?: string | null;
  proposedPayload?: unknown;
}): Promise<void> {
  await db.execute({
    sql: `INSERT INTO inbox_items
            (kind, title, detail, severity, application_id, external_event_id,
             proposed_status, proposed_company, proposed_role, proposed_next_action_date,
             confidence, dedupe_key, domain, proposed_payload)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(dedupe_key) DO UPDATE SET
            title = excluded.title,
            detail = excluded.detail,
            proposed_status = excluded.proposed_status,
            proposed_company = excluded.proposed_company,
            proposed_role = excluded.proposed_role,
            proposed_next_action_date = excluded.proposed_next_action_date,
            confidence = excluded.confidence,
            domain = excluded.domain,
            proposed_payload = excluded.proposed_payload`,
    args: [
      params.kind,
      params.title,
      params.detail,
      params.severity,
      params.applicationId,
      params.externalEventId,
      params.proposedStatus,
      params.proposedCompany ?? null,
      params.proposedRole ?? null,
      params.proposedNextActionDate ?? null,
      params.confidence,
      params.dedupeKey,
      params.domain ?? null,
      params.proposedPayload === undefined ? null : JSON.stringify(params.proposedPayload),
    ],
  });
}

/**
 * Raise a non-career proposal.
 *
 * Nothing is written to school_tasks or finance_transactions here — the same
 * "propose before create" rule that governs Career applies to every domain.
 * Confirming the inbox item is what creates the row.
 *
 * The dedupe key encodes the *situation*, not the moment of noticing: the same
 * receipt re-derives to the same key and updates its row rather than stacking
 * a second copy, and one you dismissed stays dismissed.
 */
async function proposeLifeItem(
  message: NormalizedMessage,
  externalEventId: number,
  life: DomainSignal
): Promise<ProcessResult> {
  if (life.domain === "school" && life.school) {
    const { course, title, dueDate } = life.school;
    await raiseInboxItem({
      kind: "school_proposal",
      title: title.toLowerCase().startsWith(course.toLowerCase()) ? title : `${course}: ${title}`,
      detail: dueDate ? `Due ${dueDate}. ${life.reason}` : `No date stated. ${life.reason}`,
      severity: dueDate ? "attention" : "info",
      applicationId: null,
      externalEventId,
      proposedStatus: null,
      proposedNextActionDate: dueDate,
      confidence: life.confidence,
      dedupeKey: `school:${course}:${title.slice(0, 40)}:${dueDate ?? "nodate"}`.toLowerCase(),
      domain: "school",
      proposedPayload: life.school,
    });
    return { outcome: "proposed", detail: `School: ${course}`, domain: "school" };
  }

  if (life.domain === "money" && life.money) {
    const { category, amount, date, type } = life.money;
    await raiseInboxItem({
      kind: "money_proposal",
      title: `${type === "income" ? "+" : "-"}$${amount.toFixed(2)} ${category}`,
      detail: `${life.reason}. Dated ${date}.`,
      severity: "info",
      applicationId: null,
      externalEventId,
      proposedStatus: null,
      confidence: life.confidence,
      dedupeKey: `money:${category}:${amount.toFixed(2)}:${date}`.toLowerCase(),
      domain: "money",
      proposedPayload: life.money,
    });
    return { outcome: "proposed", detail: `Money: ${category}`, domain: "money" };
  }

  return { outcome: "ignored", detail: "Unrecognized domain" };
}

async function processMessage(
  message: NormalizedMessage,
  externalEventId: number
): Promise<ProcessResult> {
  const signal = await classify(message);

  if (!signal || !signal.isCareerRelated || !signal.status) {
    // Not recruiting mail. Before discarding it, ask the wider question: most
    // of what arrives every day is a receipt or a course deadline, and both
    // already have a table waiting for them.
    const life = classifyDomain(message);
    if (life) return proposeLifeItem(message, externalEventId, life);
    return { outcome: "ignored", detail: signal?.reasoning ?? "No career signal" };
  }

  const candidateRows = await db.execute({
    sql: `SELECT a.id, a.company, a.role, a.status,
                 (SELECT e.thread_id FROM external_events e
                   JOIN application_events ae ON ae.external_event_id = e.id
                  WHERE ae.application_id = a.id AND e.thread_id IS NOT NULL
                  ORDER BY ae.id DESC LIMIT 1) AS thread_id
            FROM applications a`,
    args: [],
  });
  const candidates = candidateRows.rows as unknown as MatchCandidate[];

  const match = matchApplication(
    { company: signal.company, role: signal.role },
    candidates,
    message.threadId
  );

  const proposedCompany = displayCompany(signal.company, message);
  const label = [proposedCompany ?? signal.company ?? "An employer", signal.role]
    .filter(Boolean)
    .join(" · ");

  if (!match.applicationId) {
    // Nothing to attach to. Ambiguity is a question only you can answer. A
    // single unknown company, though, is useful enough to become a "create this
    // application?" proposal carrying the structured fields needed to seed
    // Career after confirmation.
    const canCreateApplication = !match.ambiguous && !!proposedCompany;
    await raiseInboxItem({
      kind: match.ambiguous ? "ambiguous_match" : "unmatched_career_email",
      title: match.ambiguous
        ? `Which ${signal.company} application is this about?`
        : `Create ${label} as ${signal.status}?`,
      detail: `${message.subject} · ${match.reason}`,
      severity: "attention",
      applicationId: null,
      externalEventId,
      proposedStatus: canCreateApplication ? signal.status : null,
      proposedCompany: canCreateApplication ? proposedCompany : null,
      proposedRole: canCreateApplication ? signal.role : null,
      proposedNextActionDate: canCreateApplication ? signal.deadline : null,
      confidence: signal.confidence,
      // Keyed on the thread where there is one, so a reminder about the same
      // situation updates this item instead of stacking another.
      dedupeKey: `ingest:unmatched:${message.threadId ?? message.providerMessageId}`,
    });
    return { outcome: "proposed", detail: match.reason };
  }

  const combined = signal.confidence * match.confidence;
  const trustworthy =
    signal.method === "deterministic" && combined >= AUTO_APPLY_MIN_CONFIDENCE * 0.9;

  if (trustworthy) {
    // applyEvent is the second line of defence, not the only one: it still
    // refuses a regression, a terminal reopen, or anything older than a
    // correction you made by hand.
    const applied = await applyEvent({
      applicationId: match.applicationId,
      kind: "status_change",
      toStatus: signal.status,
      occurredOn: message.receivedOn,
      detail: `${signal.reasoning}: ${message.subject}`,
      source: "gmail",
      externalEventId,
      confidence: combined,
    });

    if (applied.applied) {
      if (signal.deadline) {
        await db.execute({
          sql: `UPDATE applications
                SET next_action_date = ?, next_action_label = ?, updated_at = datetime('now')
                WHERE id = ?`,
          args: [signal.deadline, `${signal.status} due`, match.applicationId],
        });
      }
      return { outcome: "applied", detail: `${signal.status} — ${applied.reason}` };
    }

    // Refused by the guard. That is a judgement worth surfacing rather than
    // discarding: it is how you find out something disagreed with your record.
    await raiseInboxItem({
      kind: "rejected_inference",
      title: `${label} — email suggests ${signal.status}, not applied`,
      detail: `${applied.reason}. ${message.subject}`,
      severity: "info",
      applicationId: match.applicationId,
      externalEventId,
      proposedStatus: null,
      confidence: combined,
      dedupeKey: `ingest:refused:${match.applicationId}:${signal.status}`,
    });
    return { outcome: "proposed", detail: applied.reason };
  }

  await raiseInboxItem({
    kind: "proposed_status",
    title: `${label} — move to ${signal.status}?`,
    detail: `${message.subject} · ${signal.reasoning}`,
    severity: "attention",
    applicationId: match.applicationId,
    externalEventId,
    proposedStatus: signal.status satisfies ApplicationStatus,
    confidence: combined,
    // One open proposal per application per target status: a recruiter sending
    // the same reminder three times updates this row rather than adding two.
    dedupeKey: `ingest:propose:${match.applicationId}:${signal.status}`,
  });
  return { outcome: "proposed", detail: `Proposed ${signal.status}` };
}

/**
 * Run a batch of messages through the pipeline.
 *
 * Each message is recorded in external_events first. The UNIQUE constraint on
 * (provider, provider_message_id) is what makes the whole run idempotent: a
 * duplicate delivery, a re-sync after a cursor rewind, or the boundary message
 * Gmail's inclusive `after:` returns twice all collapse here, before any
 * classification happens or any model is called.
 */
export async function ingestMessages(
  provider: string,
  messages: NormalizedMessage[],
  integrationId: number | null = null
): Promise<IngestOutcome> {
  const outcome: IngestOutcome = {
    fetched: messages.length,
    ingested: 0,
    career: 0,
    applied: 0,
    proposed: 0,
    ignored: 0,
  };

  for (const message of messages) {
    const inserted = await db.execute({
      sql: `INSERT INTO external_events
              (integration_id, provider, provider_message_id, thread_id, occurred_at,
               subject, sender, snippet, processing_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
            ON CONFLICT(provider, provider_message_id) DO NOTHING
            RETURNING id`,
      args: [
        integrationId,
        provider,
        message.providerMessageId,
        message.threadId,
        message.receivedOn,
        message.subject,
        message.senderEmail ?? message.senderName,
        truncateSnippet(message.snippet),
      ],
    });

    // No row returned means this message was already ingested. Skipping here
    // rather than re-processing is what stops a repeated reminder from
    // producing a second timeline event.
    if (inserted.rows.length === 0) continue;
    outcome.ingested += 1;
    const externalEventId = Number(inserted.rows[0].id);

    let result: ProcessResult;
    try {
      result = await processMessage(message, externalEventId);
    } catch (err) {
      console.error("Ingest failed for", message.providerMessageId, err);
      await db.execute({
        sql: `UPDATE external_events
              SET processing_status = 'failed', error = ?, processed_at = datetime('now')
              WHERE id = ?`,
        args: [err instanceof Error ? err.message : "Unknown error", externalEventId],
      });
      continue;
    }

    if (result.outcome === "applied") outcome.applied += 1;
    else if (result.outcome === "proposed") outcome.proposed += 1;
    else outcome.ignored += 1;
    // Only career outcomes count as career. A receipt is a proposal too, but
    // counting it here would quietly inflate the one number that means
    // "recruiting mail seen".
    if (result.outcome !== "ignored" && !result.domain) outcome.career += 1;

    await db.execute({
      sql: `UPDATE external_events
            SET processing_status = ?, classification = ?, processed_at = datetime('now')
            WHERE id = ?`,
      args: [
        result.outcome === "ignored" ? "ignored" : "processed",
        result.detail,
        externalEventId,
      ],
    });
  }

  return outcome;
}
