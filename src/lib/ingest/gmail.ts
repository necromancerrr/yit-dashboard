import { toISODate } from "@/lib/date";
import { parseSender, truncateSnippet } from "@/lib/ingest/normalize";
import type { MailProvider, NormalizedMessage } from "@/lib/ingest/types";

/**
 * Gmail as a message source.
 *
 * Two deliberate choices:
 *
 * 1. **Metadata only.** Messages are fetched with `format=metadata`, which
 *    returns the headers named below plus Gmail's own short snippet, and never
 *    the body. The pipeline cannot store what it does not fetch, so the
 *    privacy guarantee holds even if a later change is careless.
 *
 * 2. **No SDK.** The REST API is three endpoints; pulling in googleapis to
 *    reach them would add a large dependency to a project that has kept its
 *    surface small.
 *
 * Credentials come from the environment. A long-lived refresh token is used
 * rather than a stored access token: access tokens expire in an hour, and
 * persisting one in the database would put a live credential in /api/export.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Only recruiting-shaped mail is fetched. Narrowing at the provider means the
 * rest of the mailbox is never transferred, never classified, and never
 * stored — the cheapest way to honour "do not dump my inbox into the database"
 * is not to ask for it.
 */
const RECRUITING_QUERY =
  '(subject:(application OR interview OR assessment OR offer OR recruiter OR "thank you for applying") ' +
  'OR from:(greenhouse.io OR lever.co OR myworkday.com OR ashbyhq.com OR hackerrank.com OR codility.com)) ' +
  "-category:promotions";

/** First run has no cursor; this bounds how far back it reaches. */
const FIRST_RUN_DAYS = 30;

interface GmailListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

export class GmailProvider implements MailProvider {
  readonly name = "gmail";

  constructor(
    private clientId: string,
    private clientSecret: string,
    private refreshToken: string
  ) {}

  private async accessToken(): Promise<string> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      throw new Error(`Gmail token refresh failed (${res.status}). Re-authorize the account.`);
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error("Gmail token refresh returned no access token.");
    return json.access_token;
  }

  async fetchSince(
    cursor: string | null,
    limit: number
  ): Promise<{ messages: NormalizedMessage[]; nextCursor: string | null }> {
    const token = await this.accessToken();
    const auth = { Authorization: `Bearer ${token}` };

    // The cursor is the internalDate (epoch ms) of the newest message already
    // processed. Gmail's `after:` takes seconds and is inclusive, so the
    // message on the boundary comes back again — harmless, because
    // external_events deduplicates on provider_message_id.
    const afterSeconds = cursor
      ? Math.floor(Number(cursor) / 1000)
      : Math.floor((Date.now() - FIRST_RUN_DAYS * 86_400_000) / 1000);

    const listUrl = new URL(`${API}/messages`);
    listUrl.searchParams.set("q", `${RECRUITING_QUERY} after:${afterSeconds}`);
    listUrl.searchParams.set("maxResults", String(Math.min(limit, 100)));

    const listRes = await fetch(listUrl, { headers: auth });
    if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status}).`);
    const list = (await listRes.json()) as GmailListResponse;
    const ids = list.messages ?? [];

    const messages: NormalizedMessage[] = [];
    let newestInternalDate = cursor ? Number(cursor) : 0;

    for (const { id } of ids) {
      const url = new URL(`${API}/messages/${id}`);
      url.searchParams.set("format", "metadata");
      for (const header of ["Subject", "From", "Date"]) {
        url.searchParams.append("metadataHeaders", header);
      }

      const res = await fetch(url, { headers: auth });
      if (!res.ok) continue; // One unreadable message must not fail the sync.
      const full = (await res.json()) as GmailMessage;

      const headers = new Map(
        (full.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value])
      );
      const internalDate = Number(full.internalDate ?? 0);
      if (internalDate > newestInternalDate) newestInternalDate = internalDate;

      const sender = parseSender(headers.get("from") ?? "");
      messages.push({
        providerMessageId: full.id,
        threadId: full.threadId ?? null,
        receivedOn: toISODate(internalDate ? new Date(internalDate) : new Date()),
        subject: headers.get("subject") ?? "",
        senderName: sender.name,
        senderEmail: sender.email,
        snippet: truncateSnippet(full.snippet ?? ""),
      });
    }

    // Oldest first, so a thread's events land on the timeline in the order
    // they actually happened.
    messages.sort((a, b) => a.providerMessageId.localeCompare(b.providerMessageId));
    messages.sort((a, b) => a.receivedOn.localeCompare(b.receivedOn));

    return {
      messages,
      nextCursor: newestInternalDate > 0 ? String(newestInternalDate) : cursor,
    };
  }
}

/**
 * The configured mail provider, or null when none is set up.
 *
 * Null is a first-class outcome, not an error: Gmail is genuinely optional and
 * every caller must present "not connected" as a normal state rather than a
 * failure. Nothing here fabricates messages when credentials are absent.
 */
export function getMailProvider(): MailProvider | null {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return new GmailProvider(clientId, clientSecret, refreshToken);
}
