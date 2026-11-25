// Grabit — editor window for a screenshot from history (opened from the right-click menu or the Library).
const DEFAULTS = { afterCapture: "copy", autoCopy: true, mockup: true, wallpaper: 4 };
// mirrors SWATCHES in content.js / WALLPAPERS in mockup.js
const SWATCHES = [
  "linear-gradient(135deg,#4b2a8c,#ff5fa2 60%,#ffb35c)",
  "linear-gradient(135deg,#06275c,#21d4fd 55%,#2af598)",
  "linear-gradient(135deg,#ffd86b,#ff7a59 45%,#ff2e93)",
  "linear-gradient(135deg,#1c1d22,#5a6275 60%,#2f3138)",
  "linear-gradient(160deg,#1a8fe0 0 28%,#ffb21e 38%,#ff3b4a 55%,#c2187a 80%,#5b3a8a)",
  "linear-gradient(160deg,#e9efe6 0 25%,#7f9c6c 50%,#c9874a 75%,#5e7a4e)",
];

async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) throw new Error(res?.error || "Something went wrong");
  return res;
}

(async () => {
  const msg = document.getElementById("msg");
  const id = new URLSearchParams(location.search).get("id");
  try {
    const r = await chrome.storage.local.get("settings");
    const st = { ...DEFAULTS, ...(r.settings || {}) };
    const style = { mockup: st.mockup, wallpaper: st.wallpaper };
    const result = await send("snap:loadHistory", { id, style });
    document.title = `Screenshot · ${Math.round(result.plainW / (result.u || 1))} × ${Math.round(result.plainH / (result.u || 1))}`;
    msg.textContent = "";
    window.__snapEditor.open({ result, style, copied: false, autoCopy: false, swatches: SWATCHES, send });

    // closing the editor closes this window
    new MutationObserver(() => {
      if (!document.querySelector("[data-snap-capture]")) window.close();
    }).observe(document.documentElement, { childList: true });
  } catch (e) {
    msg.textContent = String(e?.message || e);
  }
})();
