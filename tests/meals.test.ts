import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  detectMealSource,
  embedUrlFor,
  instagramEmbedUrl,
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
