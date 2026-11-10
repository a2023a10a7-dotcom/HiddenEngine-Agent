import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const OUT = "dist/source-tests";
const UA = "HiddenEngineSourceAudit/1.0 (independent provider connectivity and download test)";
const timeout = 20000;

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function downloadSample(url, name) {
  const res = await request(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error("download HTTP " + res.status);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 512) throw new Error("downloaded file is too small (" + bytes.length + " bytes)");
  const type = res.headers.get("content-type") || "unknown";
  const ext = /png/i.test(type) ? "png" : /webp/i.test(type) ? "webp" : /mp4/i.test(type) ? "mp4" : "jpg";
  const file = path.join(OUT, name + "." + ext);
  await writeFile(file, bytes);
  return { file, bytes: bytes.length, contentType: type, verified: bytes.length >= 512 };
}
async function test(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return { source: name, status: result ? "PASS" : "NO_RESULT", elapsedMs: Date.now() - started, ...(result || {}) };
  } catch (e) {
    return { source: name, status: "FAIL", elapsedMs: Date.now() - started, error: String(e.message || e) };
  }
}
await mkdir(OUT, { recursive: true });
const report = [];
report.push(await test("Pixabay", async () => {
  if (!process.env.PIXABAY_API_KEY) throw new Error("PIXABAY_API_KEY is not configured");
  const u = new URL("https://pixabay.com/api/");
  u.search = new URLSearchParams({ key: process.env.PIXABAY_API_KEY, q: "semiconductor chip", image_type: "photo", orientation: "horizontal", safesearch: "true", per_page: "8" });
  const res = await request(u);
  if (!res.ok) throw new Error("search HTTP " + res.status);
  const data = await res.json(), items = data.hits || [];
  if (!items.length) return { connected: true, httpStatus: res.status, results: 0 };
  const x = items[0], file = await downloadSample(x.largeImageURL || x.webformatURL, "pixabay");
  return { connected: true, httpStatus: res.status, results: items.length, page: x.pageURL, creator: x.user, license: "Pixabay Content License", ...file };
}));
report.push(await test("NASA Images", async () => {
  const u = "https://images-api.nasa.gov/search?q=" + encodeURIComponent("semiconductor chip") + "&media_type=image&page_size=8";
  const res = await request(u, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error("search HTTP " + res.status);
  const data = await res.json(), items = data.collection?.items || [];
  if (!items.length) return { connected: true, httpStatus: res.status, results: 0 };
  const x = items[0], meta = x.data?.[0] || {}, preview = x.links?.find(v => v.rel === "preview")?.href;
  if (!preview) return { connected: true, httpStatus: res.status, results: items.length, note: "No downloadable preview in first result" };
  const file = await downloadSample(preview, "nasa");
  return { connected: true, httpStatus: res.status, results: items.length, page: "https://images.nasa.gov/details/" + encodeURIComponent(meta.nasa_id || ""), creator: meta.center || "NASA", license: "NASA media usage guidelines", ...file };
}));
report.push(await test("Wikimedia Commons", async () => {
  const u = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({ action: "query", list: "search", srnamespace: "6", srlimit: "8", srsearch: "semiconductor chip", format: "json" });
  const res = await request(u, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error("search HTTP " + res.status);
  const data = await res.json(), items = data.query?.search || [];
  if (!items.length) return { connected: true, httpStatus: res.status, results: 0 };
  const titles = items.map(x => x.title);
  const durl = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({ action: "query", titles: titles.join("|"), prop: "imageinfo", iiprop: "url|mime|extmetadata", iiurlwidth: "1280", format: "json" });
  const dr = await request(durl, { headers: { "User-Agent": UA } });
  if (!dr.ok) throw new Error("file metadata HTTP " + dr.status);
  const dd = await dr.json(), pages = Object.values(dd.query?.pages || {});
  const p = pages.find(v => v.imageinfo?.[0]?.thumburl && /^image\/(jpeg|png|webp)$/i.test(v.imageinfo[0].mime || ""));
  if (!p) return { connected: true, httpStatus: res.status, results: items.length, note: "No supported image file among returned candidates" };
  const info = p.imageinfo[0], meta = info.extmetadata || {};
  const clean = v => String(v?.value || "").replace(/<[^>]*>/g, "").trim();
  const file = await downloadSample(info.thumburl, "wikimedia");
  return { connected: true, httpStatus: res.status, results: items.length, page: info.descriptionurl, creator: clean(meta.Artist) || "Not supplied", license: clean(meta.LicenseShortName) || "Not supplied", licenseUrl: meta.LicenseUrl?.value || "", ...file };
}));
report.push(await test("Openverse", async () => {
  const u = "https://api.openverse.org/v1/images/?" + new URLSearchParams({ q: "semiconductor chip", license: "cc0,pdm,by,by-sa", aspect_ratio: "wide", page_size: "8" });
  const res = await request(u, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error("search HTTP " + res.status);
  const data = await res.json(), items = data.results || [];
  if (!items.length) return { connected: true, httpStatus: res.status, results: 0 };
  const x = items.find(v => v.thumbnail || v.url);
  if (!x) return { connected: true, httpStatus: res.status, results: items.length, note: "No downloadable image URL" };
  const file = await downloadSample(x.thumbnail || x.url, "openverse");
  return { connected: true, httpStatus: res.status, results: items.length, page: x.foreign_landing_url || x.detail_url || x.url, creator: x.creator || "Not supplied", license: x.license || "Not supplied", licenseUrl: x.license_url || "", ...file };
}));
const summary = { testedAt: new Date().toISOString(), query: "semiconductor chip", results: report };
await writeFile(path.join(OUT, "report.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (report.some(x => x.status === "FAIL")) process.exitCode = 1;
