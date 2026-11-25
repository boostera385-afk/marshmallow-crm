import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const html = readFileSync(path.join(root, "index.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");

/** Maps a site URL (absolute on marshmallow.website, or root-relative) to its file in public/. */
const publicFile = (url: string) => path.join(root, "public", new URL(url, "https://marshmallow.website").pathname);

describe("site icons", () => {
  // Regression: the favicon and logo pointed at a Lovable-only /__l5e/ path that 404s on Vercel.
  it("every icon, manifest and share image in index.html is served from public/", () => {
    const urls = [
      ...[...doc.querySelectorAll("link[rel~='icon'], link[rel='apple-touch-icon'], link[rel='manifest']")].map((el) => el.getAttribute("href")),
      ...[...doc.querySelectorAll("meta[property='og:image'], meta[name='twitter:image']")].map((el) => el.getAttribute("content")),
    ].filter((u): u is string => Boolean(u));

    expect(urls.length).toBeGreaterThanOrEqual(6);
    for (const url of urls) {
      expect(url, url).not.toContain("/__l5e/");
      expect(url, url).not.toMatch(/lovable|r2\.dev/);
      expect(existsSync(publicFile(url)), `${url} missing from public/`).toBe(true);
    }
  });

  it("the web app manifest lists existing any + maskable icons", () => {
    const manifest = JSON.parse(readFileSync(path.join(root, "public/site.webmanifest"), "utf8")) as {
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(manifest.icons.map((i) => i.purpose)).toEqual(expect.arrayContaining(["any", "maskable"]));
    for (const icon of manifest.icons) expect(existsSync(publicFile(icon.src)), icon.src).toBe(true);
  });
});
