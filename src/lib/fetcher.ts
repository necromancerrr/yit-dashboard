import { noteNetworkFailure, noteResponse } from "@/lib/offline";

/**
 * Every write in this app goes through these three helpers, so this is the one
 * place that has to be honest about being offline.
 *
 * There is no write queue. A POST/PATCH/DELETE made with no connection fails
 * here, loudly, and the caller shows the message — the pages already render an
 * error string and `useUndoableDelete` already puts a deleted row back when its
 * DELETE fails. Queuing writes would mean telling you something was saved when
 * the server has never seen it, and this app's writes are not independent
 * facts: a career event is applied against server state by `applyEvent()`, and
 * a checklist tick is resolved against the server's idea of today. Replaying
 * those hours later, out of order, against state that moved on is how you get a
 * pipeline that quietly disagrees with its own event log.
 */
const OFFLINE_WRITE_MESSAGE = "You're offline — this change was not saved. Try again when you reconnect.";
const OFFLINE_READ_MESSAGE = "You're offline and there's no saved copy of this data.";

/** A rejected fetch means the request never reached the origin. */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

export const fetcher = async (url: string) => {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    if (isNetworkError(err)) {
      noteNetworkFailure();
      throw new Error(OFFLINE_READ_MESSAGE);
    }
    throw err;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // The service worker answers an unservable read with 503 and an explanation
    // rather than an empty 200, so prefer its message over a generic one.
    throw new Error((data && typeof data.error === "string" && data.error) || "Request failed");
  }
  // Records whether this body arrived live or out of the worker's cache, which
  // is what OfflineBanner reads to say when the data on screen is from.
  noteResponse(data);
  return data;
};

async function write<T>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch (err) {
    if (isNetworkError(err)) {
      noteNetworkFailure();
      throw new Error(OFFLINE_WRITE_MESSAGE);
    }
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

export function apiPost<T>(url: string, body: unknown): Promise<T> {
  return write<T>(url, "POST", body);
}

export function apiPatch<T>(url: string, body: unknown): Promise<T> {
  return write<T>(url, "PATCH", body);
}

export async function apiDelete(url: string): Promise<void> {
  await write<unknown>(url, "DELETE");
}
