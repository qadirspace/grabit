// Grabit — background service worker.
// Captures the visible tab, keeps frames per tab, and composes the final PNG.
// Everything stays local: no network requests are made anywhere.

importScripts("mockup.js"); // defines self.SnapMockup

// Chrome allows at most 2 captureVisibleTab calls per second.
const MIN_CAPTURE_INTERVAL_MS = 550;
// Keep canvases under Chrome's size limits.
const MAX_CANVAS_SIDE = 30000;

const sessions = new Map(); // tabId -> { frames: ImageBitmap[], lastCaptureAt, lastPng }

function getSession(tabId) {
  let s = sessions.get(tabId);
  if (!s) {
    s = { frames: [], lastCaptureAt: 0, lastPng: null };
    sessions.set(tabId, s);
  }
  return s;
}

function clearFrames(s) {
  for (const f of s.frames) f.close?.();
  s.frames = [];
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const s = sessions.get(tabId);
  if (s) { clearFrames(s); s.plain?.bitmap.close?.(); }
  sessions.delete(tabId);
});

// Inject (or toggle) the picker in a tab. Triggered by a toolbar icon click or Alt+Shift+S.
async function startCapture(tab) {
  if (!tab?.id) throw new Error("No active tab");
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["editor.js", "content.js"],
    });
  } catch (err) {
    // chrome://, the Web Store, and some other pages can't be scripted.
    console.warn("Grabit: cannot run on this page.", err);
    chrome.action.setBadgeBackgroundColor({ color: "#d93025", tabId: tab.id });
    chrome.action.setBadgeText({ text: "!", tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 2500);
    throw new Error("Chrome doesn't allow captures on this page.");
  }
  return {};
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "start-capture") startCapture(tab).catch(() => {});
});

// Clicking the toolbar icon starts (or cancels) a capture right away. There is no popup.
chrome.action.onClicked.addListener((tab) => startCapture(tab).catch(() => {}));

// ---------- right-click menu on the toolbar icon: recent screenshots + Library ----------
// Chrome allows at most 6 top-level items here: 3 screenshots, a separator, Library, Settings.
// (Chrome adds its own items, such as Options, below these.)
function menuLabel(entry) {
  const d = new Date(entry.time);
  const sameDay = d.toDateString() === new Date().toDateString();
  const when = sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${screenshotName(entry.w, entry.h, entry.u)}  ·  ${when}`;
}

// Every screenshot is simply called "Screenshot" plus its size in CSS pixels.
function screenshotName(w, h, u = 1) {
  return `Screenshot · ${Math.round(w / u)} × ${Math.round(h / u)}`;
}

let menuQueue = Promise.resolve();
function rebuildMenu() {
  // Serialized, so two quick rebuilds can't create duplicate ids.
  menuQueue = menuQueue.then(async () => {
    const { history = [] } = await chrome.storage.local.get("history");
    await chrome.contextMenus.removeAll();
    const add = (props) => new Promise((res) => chrome.contextMenus.create({ contexts: ["action"], ...props }, () => { void chrome.runtime.lastError; res(); }));
    if (!history.length) await add({ id: "empty", title: "No screenshots yet", enabled: false });
    for (const h of history.slice(0, HISTORY_MAX)) await add({ id: "hist:" + h.id, title: menuLabel(h) });
    await add({ id: "sep", type: "separator" });
    await add({ id: "library", title: "Open Library" });
    await add({ id: "settings", title: "Settings" });
  }).catch((e) => console.warn("Grabit: could not build the menu", e));
  return menuQueue;
}

chrome.runtime.onInstalled.addListener(rebuildMenu);
chrome.runtime.onStartup.addListener(rebuildMenu);
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.history) rebuildMenu(); });

chrome.contextMenus.onClicked.addListener((info) => {
  const id = String(info.menuItemId);
  if (id.startsWith("hist:")) openEditorWindow(id.slice(5)).catch(() => {});
  else if (id === "library") openLibrary();
  else if (id === "settings") chrome.runtime.openOptionsPage();
});

// Focus the Library tab if it's already open, otherwise open it.
async function openLibrary() {
  const url = chrome.runtime.getURL("library.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  return {};
}

// ---------- history: the last 3 captures, kept locally ----------
const HISTORY_MAX = 3;

async function saveHistory(bitmap, u, tab) {
  try {
    const full = new OffscreenCanvas(bitmap.width, bitmap.height);
    full.getContext("2d").drawImage(bitmap, 0, 0);
    const plainB64 = await canvasToBase64(full);
    const k = Math.min(1, 360 / bitmap.width, 240 / bitmap.height);
    const tw = Math.max(1, Math.round(bitmap.width * k)), th = Math.max(1, Math.round(bitmap.height * k));
    const t = new OffscreenCanvas(tw, th);
    const tc = t.getContext("2d");
    tc.imageSmoothingQuality = "high";
    tc.drawImage(bitmap, 0, 0, tw, th);
    const thumb = arrayBufferToBase64(await (await t.convertToBlob({ type: "image/jpeg", quality: 0.82 })).arrayBuffer());
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const entry = {
      id, time: Date.now(), w: bitmap.width, h: bitmap.height, u,
      title: tab?.title || "", url: tab?.url || "",
      thumb: "data:image/jpeg;base64," + thumb,
    };
    const { history = [] } = await chrome.storage.local.get("history");
    history.unshift(entry);
    const removed = history.splice(HISTORY_MAX);
    await chrome.storage.local.set({ history, ["hist:" + id]: plainB64 });
    if (removed.length) await chrome.storage.local.remove(removed.map((e) => "hist:" + e.id));
  } catch (e) {
    console.warn("Grabit: could not save to history", e);
  } finally {
    bitmap.close?.();
  }
}

// Load a history capture into a session so it can be rendered / edited / saved.
async function loadHistory(key, id, style, includePlain) {
  const { history = [] } = await chrome.storage.local.get("history");
  const entry = history.find((e) => e.id === id);
  if (!entry) throw new Error("That screenshot is no longer in history.");
  const data = (await chrome.storage.local.get("hist:" + id))["hist:" + id];
  if (!data) throw new Error("That screenshot is no longer in history.");
  const bitmap = await createImageBitmap(base64ToBlob(data));
  const s = getSession(key);
  s.plain?.bitmap.close?.();
  s.plain = { bitmap, u: entry.u || 1 };
  const res = await renderStyled(s, style, null, includePlain);
  return { ...res, entry: { id: entry.id, time: entry.time, title: entry.title, url: entry.url } };
}

async function openEditorWindow(id) {
  await chrome.windows.create({
    url: chrome.runtime.getURL("editor.html?id=" + encodeURIComponent(id)),
    type: "popup", width: 1180, height: 820, focused: true,
  });
  return {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureFrame(tab) {
  const s = getSession(tab.id);
  const wait = s.lastCaptureAt + MIN_CAPTURE_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  s.lastCaptureAt = Date.now();

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const blob = await (await fetch(dataUrl)).blob(); // data: URL fetch is local
  const bitmap = await createImageBitmap(blob);
  s.frames.push(bitmap);
  return { index: s.frames.length - 1 };
}

// specs: [{ frame, sx, sy, sw, sh, dx, dy }] in CSS pixels.
// viewportWidth: window.innerWidth of the page when frames were taken.
async function compose(tab, { width, height, viewportWidth, specs, style, includePlain }) {
  const s = getSession(tab.id);
  if (!s.frames.length) throw new Error("No frames captured");

  const scale = s.frames[0].width / viewportWidth; // devicePixelRatio × zoom
  let outW = Math.max(1, Math.round(width * scale));
  let outH = Math.max(1, Math.round(height * scale));
  let shrink = 1;
  if (outW > MAX_CANVAS_SIDE || outH > MAX_CANVAS_SIDE) {
    shrink = Math.min(MAX_CANVAS_SIDE / outW, MAX_CANVAS_SIDE / outH);
    outW = Math.round(outW * shrink);
    outH = Math.round(outH * shrink);
  }
  const k = scale * shrink;

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";

  // Round edges (not sizes) so neighbouring slices meet exactly — no 1px seams.
  const span = (a, len, f) => {
    const start = Math.round(a * f);
    return [start, Math.max(1, Math.round((a + len) * f) - start)];
  };
  for (const sp of specs) {
    const bmp = s.frames[sp.frame];
    if (!bmp) continue;
    const [sx, sw] = span(sp.sx, sp.sw, scale);
    const [sy, sh] = span(sp.sy, sp.sh, scale);
    const [dx, dw] = span(sp.dx, sp.sw, k);
    const [dy, dh] = span(sp.dy, sp.sh, k);
    ctx.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  clearFrames(s);

  // Keep the plain capture so the toast can switch Plain / Mockup / wallpaper later.
  s.plain?.bitmap.close?.();
  s.plain = { bitmap: canvas.transferToImageBitmap(), u: k };
  createImageBitmap(s.plain.bitmap).then((copy) => saveHistory(copy, k, tab)); // not awaited
  return renderStyled(s, style, null, includePlain);
}

// Photo wallpapers are files inside the extension; decode once and keep them.
const wallpaperCache = new Map();
async function wallpaperImage(style) {
  const wp = SnapMockup.WALLPAPERS[(style?.wallpaper ?? 0) % SnapMockup.WALLPAPERS.length];
  if (!wp?.image) return null;
  if (!wallpaperCache.has(wp.image)) {
    const p = fetch(chrome.runtime.getURL(wp.image))
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b));
    p.catch(() => wallpaperCache.delete(wp.image));
    wallpaperCache.set(wp.image, p);
  }
  return wallpaperCache.get(wp.image);
}

// style:   { mockup: boolean, wallpaper: number }
// overlay: optional base64 PNG of annotations, same pixel size as the plain capture
// includePlain: also return the untouched capture (the editor needs it for Blur)
async function renderStyled(s, style, overlay, includePlain) {
  if (!s.plain) throw new Error("Nothing captured yet");
  const { bitmap, u } = s.plain;

  let src = bitmap;
  if (overlay) {
    const ov = await createImageBitmap(base64ToBlob(overlay));
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const x = c.getContext("2d");
    x.drawImage(bitmap, 0, 0);
    x.drawImage(ov, 0, 0, bitmap.width, bitmap.height);
    ov.close();
    src = c;
  }

  let out = null;
  if (style?.mockup) {
    const img = await wallpaperImage(style).catch(() => null);
    out = SnapMockup.render(src, style, u, img);
  }
  if (!out) {
    out = new OffscreenCanvas(bitmap.width, bitmap.height);
    out.getContext("2d").drawImage(src, 0, 0);
  }
  const base64 = await canvasToBase64(out);
  s.lastPng = base64;

  const res = {
    base64, width: out.width, height: out.height,
    contentX: out.contentX || 0, contentY: out.contentY || 0,
    plainW: bitmap.width, plainH: bitmap.height, u,
  };
  if (includePlain) {
    const pc = new OffscreenCanvas(bitmap.width, bitmap.height);
    pc.getContext("2d").drawImage(bitmap, 0, 0);
    res.plainBase64 = await canvasToBase64(pc);
  }
  return res;
}

async function canvasToBase64(c) {
  const blob = await c.convertToBlob({ type: "image/png" });
  return arrayBufferToBase64(await blob.arrayBuffer());
}

function base64ToBlob(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

async function download(key) {
  const s = getSession(key);
  if (!s.lastPng) throw new Error("Nothing to save yet");
  await chrome.downloads.download({
    url: "data:image/png;base64," + s.lastPng,
    // e.g. "Screenshot 289x111 2026-11-25 at 17.05.12.png"
    filename: `Grabit/Screenshot ${s.plain ? `${Math.round(s.plain.bitmap.width / s.plain.u)}x${Math.round(s.plain.bitmap.height / s.plain.u)} ` : ""}${timestamp()}.png`,
    saveAs: false,
  });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tab = sender.tab;
  if (!tab?.id) return false;
  const key = tab.id;

  let work;
  switch (msg?.type) {
    // ----- Library page -----
    case "snap:historyList":
      work = chrome.storage.local.get("history").then((r) => ({ history: r.history || [] }));
      break;
    case "snap:historyRender":
      work = loadHistory(key, msg.id, msg.style, false);
      break;
    case "snap:openEditor":
      work = openEditorWindow(msg.id);
      break;
    // ----- editor window -----
    case "snap:loadHistory":
      work = loadHistory(key, msg.id, msg.style, true);
      break;
    // ----- page (content script) -----
    case "snap:begin":
      clearFrames(getSession(tab.id));
      work = Promise.resolve({ ok: true });
      break;
    case "snap:captureFrame":
      work = captureFrame(tab);
      break;
    case "snap:compose":
      work = compose(tab, msg);
      break;
    case "snap:render":
      work = renderStyled(getSession(key), msg.style, msg.overlay);
      break;
    case "snap:openOptions":
      work = chrome.runtime.openOptionsPage().then(() => ({}));
      break;
    case "snap:download":
      work = download(key);
      break;
    default:
      return false;
  }
  work.then(
    (res) => sendResponse({ ok: true, ...res }),
    (err) => sendResponse({ ok: false, error: String(err?.message || err) })
  );
  return true; // async response
});
