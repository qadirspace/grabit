// Grabit — settings page. Stored in chrome.storage.local under "settings".
const DEFAULTS = { afterCapture: "copy", autoCopy: true, mockup: true, wallpaper: 4 };

// Must match the order of WALLPAPERS in mockup.js.
const WALLS = [
  { name: "Dusk", css: "linear-gradient(135deg,#1d1b4f,#4b2a8c 40%,#ff5fa2 75%,#ffb35c)" },
  { name: "Lagoon", css: "linear-gradient(135deg,#06275c,#0a5c8c 40%,#21d4fd 70%,#2af598)" },
  { name: "Sunrise", css: "linear-gradient(135deg,#ffd86b,#ff7a59 45%,#ff2e93 80%,#b84dff)" },
  { name: "Graphite", css: "linear-gradient(135deg,#1c1d22,#3d4250 50%,#5a6275)" },
  { name: "Bg-1", img: "Bg-1.jpg" },
  { name: "Bg-2", img: "Bg-2.jpg" },
];

const storage = globalThis.chrome?.storage?.local;
let settings = { ...DEFAULTS };

const $ = (s) => document.querySelector(s);
const wallsEl = $("#walls");

WALLS.forEach((w, i) => {
  const label = document.createElement("label");
  label.className = "wall";
  if (w.css) label.style.background = w.css;
  label.innerHTML = `<input type="radio" name="wallpaper" value="${i}" aria-label="${w.name}">${w.img ? `<img src="${w.img}" alt="">` : ""}<span class="name">${w.name}</span>`;
  wallsEl.appendChild(label);
});

function render() {
  document.querySelectorAll('input[name="afterCapture"]').forEach((r) => (r.checked = r.value === settings.afterCapture));
  $("#autoCopy").checked = !!settings.autoCopy;
  $("#mockup").checked = !!settings.mockup;
  document.querySelectorAll('input[name="wallpaper"]').forEach((r) => (r.checked = +r.value === settings.wallpaper));
  wallsEl.classList.toggle("off", !settings.mockup);
}

let toastTimer;
function save(patch) {
  settings = { ...settings, ...patch };
  render();
  storage?.set({ settings });
  const t = $("#saved");
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1200);
}

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.name === "afterCapture") save({ afterCapture: el.value });
  else if (el.name === "wallpaper") save({ wallpaper: +el.value });
  else if (el.id === "autoCopy") save({ autoCopy: el.checked });
  else if (el.id === "mockup") save({ mockup: el.checked });
});

$("#editShortcut").addEventListener("click", () => {
  chrome.tabs?.create({ url: "chrome://extensions/shortcuts" });
});

(async () => {
  try {
    const r = await storage?.get("settings");
    if (r?.settings) settings = { ...DEFAULTS, ...r.settings };
  } catch { /* defaults */ }
  render();
  try {
    const cmds = await chrome.commands.getAll();
    const c = cmds.find((x) => x.name === "start-capture");
    $("#shortcut").textContent = c?.shortcut || "Not set";
  } catch { /* not in extension context */ }
})();
