import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  detectMealSource,
  embedUrlFor,
  instagramEmbedUrl,
  isShortLinkHost,
  tiktokEmbedUrl,
  youtubeEmbedUrl,
} from "@/lib/meal-source";

describe("detectMealSource — instagram", () => {
  test("parses a /p/ link", () => {
    const s = detectMealSource("https://www.instagram.com/p/C8abcXYZ123/");
    assert.equal(s?.platform, "instagram");
    assert.equal(s?.nativeId, "C8abcXYZ123");
    assert.equal(s?.url, "https://www.instagram.com/p/C8abcXYZ123/");
  });

  test("parses a /reel/ link and canonicalizes it", () => {
    const s = detectMealSource("instagram.com/reel/DIFFERENT_1-2?utm_source=ig_web_copy_link");
    assert.equal(s?.platform, "instagram");
    assert.equal(s?.nativeId, "DIFFERENT_1-2");
    assert.equal(s?.url, "https://www.instagram.com/p/DIFFERENT_1-2/");
  });

  test("rejects a profile page — it is not a post", () => {
    assert.equal(detectMealSource("https://www.instagram.com/some.chef/"), null);
  });
});

describe("detectMealSource — tiktok", () => {
  test("parses an @user/video link", () => {
    const s = detectMealSource("https://www.tiktok.com/@chef/video/7382910461726354721");
    assert.equal(s?.platform, "tiktok");
    assert.equal(s?.nativeId, "7382910461726354721");
  });

  test("rejects a short link — it needs a redirect the pure parser cannot do", () => {
    assert.equal(detectMealSource("https://vm.tiktok.com/ZMabc123/"), null);
  });

  test("rejects a non-video page", () => {
    assert.equal(detectMealSource("https://www.tiktok.com/@chef"), null);
  });
});

describe("detectMealSource — youtube", () => {
  test("parses a watch link", () => {
    const s = detectMealSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s");
    assert.equal(s?.platform, "youtube");
    assert.equal(s?.nativeId, "dQw4w9WgXcQ");
    assert.equal(s?.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  test("parses a youtu.be link", () => {
    const s = detectMealSource("https://youtu.be/dQw4w9WgXcQ");
    assert.equal(s?.platform, "youtube");
    assert.equal(s?.nativeId, "dQw4w9WgXcQ");
  });

  test("parses a shorts link", () => {
    const s = detectMealSource("https://www.youtube.com/shorts/dQw4w9WgXcQ");
    assert.equal(s?.platform, "youtube");
    assert.equal(s?.nativeId, "dQw4w9WgXcQ");
  });
});

describe("detectMealSource — rejection", () => {
  test("rejects non-video hosts", () => {
    assert.equal(detectMealSource("https://example.com/recipe"), null);
    assert.equal(detectMealSource("not a url at all"), null);
    assert.equal(detectMealSource(""), null);
  });

  test("rejects non-https schemes", () => {
    assert.equal(detectMealSource("http://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
  });
});

describe("embed urls", () => {
  test("each platform maps to its public embed", () => {
    assert.equal(instagramEmbedUrl("ABC"), "https://www.instagram.com/p/ABC/embed");
    assert.equal(tiktokEmbedUrl("123"), "https://www.tiktok.com/embed/v2/123");
    assert.equal(youtubeEmbedUrl("xyz"), "https://www.youtube-nocookie.com/embed/xyz");
  });

  test("embedUrlFor dispatches on platform", () => {
    assert.equal(
      embedUrlFor({ platform: "instagram", url: "https://www.instagram.com/p/A/", nativeId: "A" }),
      "https://www.instagram.com/p/A/embed"
    );
    assert.equal(
      embedUrlFor({ platform: "tiktok", url: "https://www.tiktok.com/@u/video/1", nativeId: "1" }),
      "https://www.tiktok.com/embed/v2/1"
    );
  });
});

describe("isShortLinkHost", () => {
  test("recognizes TikTok short-link hosts", () => {
    assert.equal(isShortLinkHost("https://vm.tiktok.com/AbC123/"), true);
    assert.equal(isShortLinkHost("https://vt.tiktok.com/xyz"), true);
  });

  test("rejects canonical hosts and unrelated domains", () => {
    assert.equal(isShortLinkHost("https://www.tiktok.com/@u/video/1"), false);
    assert.equal(isShortLinkHost("https://www.instagram.com/p/A/"), false);
    assert.equal(isShortLinkHost("https://evil.example/redirect"), false);
    assert.equal(isShortLinkHost("https://vm.tiktok.com.evil.example/"), false);
    assert.equal(isShortLinkHost("not a url"), false);
  });

  test("short links are not meal sources on their own", () => {
    // Pure parsing can't resolve them — the import route does, but only for
    // allowlisted hosts.
    assert.equal(detectMealSource("https://vm.tiktok.com/AbC123/"), null);
  });
});

describe("POST /api/meals/import — SSRF guard", () => {
  async function postImport(url: string, stub: (url: string) => Promise<unknown>) {
    const { POST } = await import("@/app/api/meals/import/route");
    const { NextRequest } = await import("next/server");
    const origFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      calls.push(String(input));
      return stub(String(input));
    }) as typeof fetch;
    try {
      const req = new NextRequest("http://localhost/api/meals/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const res = await POST(req);
      return { res, calls, body: (await res.json()) as Record<string, unknown> };
    } finally {
      globalThis.fetch = origFetch;
    }
  }

  test("never fetches an arbitrary unrecognized URL", async () => {
    const { res, calls } = await postImport("https://internal.example/admin", async () => {
      throw new Error("must not fetch");
    });
    assert.equal(res.status, 422);
    assert.deepEqual(calls, []);
  });

  test("resolves an allowlisted TikTok short link via redirect headers", async () => {
    const { res, calls, body } = await postImport("https://vm.tiktok.com/AbC123/", async (url) => {
      if (url.startsWith("https://vm.tiktok.com")) {
        return { status: 301, headers: new Headers({ location: "https://www.tiktok.com/@cook/video/123/" }) };
      }
      if (url.includes("oembed")) {
        return {
          ok: true,
          json: async () => ({ title: "15-min pasta", author_name: "@cook", thumbnail_url: "https://img/t.jpg" }),
        };
      }
      return { status: 200, headers: new Headers() };
    });
    assert.equal(res.status, 200);
    assert.equal(body.platform, "tiktok");
    assert.equal(body.nativeId, "123");
    assert.equal(body.thumbnailUrl, "https://img/t.jpg");
    // The short host was fetched, and the oEmbed endpoint — nothing else.
    assert.ok(calls.some((c) => c.startsWith("https://vm.tiktok.com")));
    assert.ok(calls.every((c) => c.startsWith("https://vm.tiktok.com") || c.includes("oembed") || c.startsWith("https://www.tiktok.com")));
  });
});
