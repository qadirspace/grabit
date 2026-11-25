// Grabit — Library page: the last 3 screenshots, to open in the editor, copy again or delete.
const DEFAULTS = { afterCapture: "copy", autoCopy: true, mockup: true, wallpaper: 4 };
const $ = (s) => document.querySelector(s);

async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) throw new Error(res?.error || "Something went wrong");
  return res;
}

function b64ToBlob(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + " h ago";
  return new Date(t).toLocaleDateString();
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function note(text) { $("#note").textContent = text || ""; }

$("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

async function deleteEntry(id) {
  const { history = [] } = await chrome.storage.local.get("history");
  await chrome.storage.local.set({ history: history.filter((e) => e.id !== id) });
  await chrome.storage.local.remove("hist:" + id);
  // the storage listener below re-renders the list
}

async function render() {
  const list = $("#list");
  let history = [];
  try { history = (await send("snap:historyList")).history; } catch (e) { note(String(e.message || e)); }
  list.textContent = "";
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No screenshots yet. Click the toolbar icon on any page to capture one.";
    list.appendChild(empty);
    return;
  }
  for (const h of history) {
    const item = document.createElement("div");
    item.className = "item";

    const open = document.createElement("button");
    open.className = "thumb";
    open.title = "Open in the editor";
    const img = document.createElement("img");
    img.alt = "";
    img.src = h.thumb;
    open.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `Screenshot · ${Math.round(h.w / (h.u || 1))} × ${Math.round(h.h / (h.u || 1))}`;
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = [ago(h.time), hostOf(h.url)].filter(Boolean).join(" · ");
    meta.append(title, sub);

    const actions = document.createElement("div");
    actions.className = "actions";
    const edit = document.createElement("button");
    edit.className = "primary";
    edit.textContent = "Open";
    const copy = document.createElement("button");
    copy.textContent = "Copy";
    const spacer = document.createElement("span");
    spacer.className = "spacer";
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "Delete";
    actions.append(edit, copy, spacer, del);

    const openEditor = async () => {
      try { await send("snap:openEditor", { id: h.id }); }
      catch (e) { note(String(e.message || e)); }
    };
    open.addEventListener("click", openEditor);
    edit.addEventListener("click", openEditor);

    copy.addEventListener("click", () => {
      // the clipboard write must start inside the click; the image arrives a moment later
      const p = chrome.storage.local.get("settings")
        .then((r) => ({ ...DEFAULTS, ...(r.settings || {}) }))
        .then((st) => send("snap:historyRender", { id: h.id, style: { mockup: st.mockup, wallpaper: st.wallpaper } }))
        .then((r) => b64ToBlob(r.base64));
      navigator.clipboard.write([new ClipboardItem({ "image/png": p })]).then(
        () => { copy.textContent = "Copied ✓"; copy.classList.add("ok"); },
        () => { copy.textContent = "Copy"; note("Couldn't copy. Open it and use Save instead."); }
      );
    });

    del.addEventListener("click", () => {
      deleteEntry(h.id).catch((e) => note(String(e.message || e)));
    });

    item.append(open, meta, actions);
    list.appendChild(item);
  }
}

// New captures (or deletions) show up without reloading the page.
chrome.storage?.onChanged?.addListener((ch, area) => { if (area === "local" && ch.history) render(); });

(async () => {
  try {
    const cmds = await chrome.commands.getAll();
    const c = cmds.find((x) => x.name === "start-capture");
    $("#shortcut").textContent = c?.shortcut || "no shortcut set";
  } catch { /* ignore */ }
  render();
})();
