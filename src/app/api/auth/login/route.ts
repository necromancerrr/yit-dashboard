import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, getSessionCookieOptions, verifyPassword } from "@/lib/auth";
import { handleRoute, jsonError } from "@/lib/api-helpers";

const schema = z.object({ password: z.string().min(1) });

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const { password } = schema.parse(await req.json());
    const ok = await verifyPassword(password);
    if (!ok) return jsonError("Incorrect password", 401);

    const token = await createSessionToken();
    const options = await getSessionCookieOptions();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(options.name, token, options);
    return res;
  });
}
