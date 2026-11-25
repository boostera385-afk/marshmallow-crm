#!/usr/bin/env node
/**
 * Generates every favicon / app icon / social image in public/ from the single source mark
 * src/assets/brand/marshmallow-mark.svg, using the Playwright Chromium the repo already
 * installs for browser tests. Re-run after changing the mark:  npm run brand:icons
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = (name) => path.join(root, "public", name);
const source = await readFile(path.join(root, "src/assets/brand/marshmallow-mark.svg"), "utf8");

/** Square tile (no rounded corners) with the artwork scaled into the platform's safe zone. */
const fullBleed = (scale) =>
  source
    .replaceAll('rx="116"', 'rx="0"')
    .replace('<g id="mm-art">', `<g id="mm-art" transform="translate(256 256) scale(${scale}) translate(-256 -256)">`);

const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// Prefer Playwright's bundled Chromium; fall back to the installed Google Chrome.
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function renderHtml(html, width, height, transparent = true) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${html}</body></html>`);
  await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
}

const renderSvg = (svg, size, transparent = true) =>
  renderHtml(`<img src="${dataUri(svg)}" width="${size}" height="${size}" style="display:block">`, size, size, transparent);

/** ICO container holding PNG images (supported by every current browser and Windows). */
function toIco(pngs) {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

const outputs = [];
const save = async (name, data) => {
  await writeFile(pub(name), data);
  outputs.push(`${name} (${(data.length / 1024).toFixed(1)} KB)`);
};

await save("favicon.svg", source);
const icoSizes = [16, 32, 48];
await save("favicon.ico", toIco(await Promise.all(icoSizes.map(async (size) => ({ size, data: await renderSvg(source, size) })))));
await save("favicon-32x32.png", await renderSvg(source, 32));
await save("icon-192.png", await renderSvg(source, 192));
await save("icon-512.png", await renderSvg(source, 512));
await save("icon-maskable-512.png", await renderSvg(fullBleed(0.8), 512, false));
await save("apple-touch-icon.png", await renderSvg(fullBleed(0.9), 180, false));

const og = `
<div style="width:1200px;height:630px;box-sizing:border-box;padding:96px;display:flex;flex-direction:column;justify-content:center;
  background:radial-gradient(circle at 12% 8%,rgba(111,155,255,.35),transparent 42%),radial-gradient(circle at 92% 96%,rgba(91,63,217,.4),transparent 46%),#11131C;
  font-family:'Segoe UI',Inter,system-ui,sans-serif;color:#EEF1F8">
  <div style="display:flex;align-items:center;gap:36px">
    <img src="${dataUri(source)}" width="168" height="168" style="filter:drop-shadow(0 24px 48px rgba(61,99,230,.55))">
    <div>
      <div style="font-size:88px;font-weight:700;letter-spacing:-2px;line-height:1">Marshmallow</div>
      <div style="margin-top:18px;font-size:34px;color:#A9B3CE">Home-services CRM</div>
    </div>
  </div>
  <div style="margin-top:64px;font-size:30px;color:#C9D2EA;max-width:900px;line-height:1.4">
    Track every lead from first call to paid job: scheduling, approvals and team workflow in one place.
  </div>
</div>`;
await save("og-image.png", await renderHtml(og, 1200, 630, false));

await browser.close();
console.log(`Generated in public/:\n  ${outputs.join("\n  ")}`);
