import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withDb } from "@/lib/api-helpers";

// The OS share sheet posts here.
//
// Deliberately at /share rather than /api/share: the proxy answers an
// unauthenticated /api request with a 401 JSON body, which would be a dead end
// in a share sheet. A page path gets redirected to the login screen instead,
// so a locked-out share fails somewhere you can act.
//
// Nothing is extracted here. The image is parked, and the ordinary Scan review
// flow picks it up — sharing a screenshot must not be a way to write rows
// without seeing them first.

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Stale rows are useless the moment their page load is gone. */
async function sweepOldShares(): Promise<void> {
  await db.execute("DELETE FROM shared_images WHERE created_at < datetime('now', '-1 hour')");
}

function redirectTo(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, req.nextUrl.origin), {
    // 303 so the browser follows a POST with a GET, which is what a share
    // sheet expects; a 307 would replay the POST against a page.
    status: 303,
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("image");

    if (!(file instanceof File) || file.size === 0) {
      return redirectTo(req, "/money?shared=empty");
    }
    if (!ALLOWED.includes(file.type)) {
      return redirectTo(req, "/money?shared=unsupported");
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return redirectTo(req, "/money?shared=toolarge");
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    const id = await withDb(async () => {
      await sweepOldShares();
      const result = await db.execute({
        sql: "INSERT INTO shared_images (media_type, data) VALUES (?, ?) RETURNING id",
        args: [file.type, base64],
      });
      return Number(result.rows[0].id);
    });

    return redirectTo(req, `/money?shared=${id}`);
  } catch (err) {
    console.error("Share target failed:", err);
    return redirectTo(req, "/money?shared=failed");
  }
}

/**
 * A share that arrives while signed out is redirected to the login page, and
 * comes back here as a GET with the image long gone. Land somewhere useful
 * rather than on a 405.
 */
export function GET(req: NextRequest) {
  return redirectTo(req, "/money?shared=retry");
}
