// Grabit — post-capture editor (centered window).
// Pen, highlighter, arrow, box, blur; undo/redo; Plain/Mockup + wallpaper; copy/save.
// Annotations are drawn in screenshot pixels and merged by the background worker,
// so they land inside the mockup window, never on the wallpaper.
(() => {
  if (window.__snapEditor) return;

  const Z = "2147483647";
  const T = {
    accent: "#f2704f", deep: "#d4532f", ink: "#2a2230", inkSoft: "#6d6370",
    grad: "linear-gradient(120deg, #ff9a4f 0%, #ff7a66 40%, #ea86a6 72%, #8fabd4 100%)",
    btnGrad: "linear-gradient(135deg, #ff9a4f 0%, #f56f5b 55%, #e5809f 100%)",
  };
  const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#111111"];
  const SIZES = [2, 4, 8]; // CSS px; scaled by capture density
  const I = (d, extra = "") =>
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const TOOLS = [
    { id: "pen", key: "p", label: "Pen (P)", icon: I('<path d="M4 20l4.5-1L19 8.5 15.5 5 5 15.5 4 20z"/><path d="M13.5 7l3.5 3.5"/>') },
    { id: "hl", key: "h", label: "Highlighter (H)", icon: I('<path d="M5 19h6"/><path d="M8.5 15.5l-2 2 2.5.5 1.5-1.5"/><path d="M9 15l9-9-3-3-9 9 3 3z"/>') },
    { id: "arrow", key: "a", label: "Arrow (A)", icon: I('<path d="M5 19L19 5"/><path d="M10 5h9v9"/>') },
    { id: "rect", key: "r", label: "Box (R)", icon: I('<rect x="4" y="5.5" width="16" height="13" rx="2.5"/>') },
    { id: "blur", key: "b", label: "Blur / hide (B)", icon: I('<path d="M4 4h5v5H4zM15 4h5v5h-5zM9.5 9.5h5v5h-5zM4 15h5v5H4zM15 15h5v5h-5z" fill="currentColor" stroke="none"/>') },
  ];
  const ICON = {
    undo: I('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>'),
    redo: I('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>'),
    clear: I('<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>'),
    close: I('<path d="M6 6l12 12M18 6L6 18"/>'),
    gear: I('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  };

  let current = null; // { close() }

  function b64ToBlob(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: "image/png" });
  }
  function blobToB64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(",")[1]);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }

  /**
   * opts: {
   *   result:   render result from the worker (base64, width, height, contentX, contentY, plainW, plainH, u, plainBase64)
   *   style:    { mockup, wallpaper }
   *   copied:   whether the first render already reached the clipboard
   *   autoCopy: whether auto-copy is on (for the status text)
   *   swatches: CSS backgrounds for the wallpaper buttons
   *   send:     (type, payload) => Promise   — talks to the worker
   * }
   */
  function open(opts) {
    current?.close();

    let { result, style } = opts;
    style = { ...style };
    const send = opts.send;
    let tool = "pen", color = COLORS[0], size = SIZES[1];
    let shapes = [], redoStack = [], drawing = null;
    let dirty = !opts.copied; // clipboard is out of date
    let plainBmp = null;
    let busy = false;

    const host = document.createElement("div");
    host.setAttribute("data-snap-capture", "");
    host.style.cssText = `all:initial;position:fixed;inset:0;z-index:${Z};`;
    const sr = host.attachShadow({ mode: "open" });
    sr.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .backdrop {
          position: fixed; inset: 0; display: grid; place-items: center;
          font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: ${T.ink};
          background: rgba(42,26,30,.42);
        }
        .panel {
          border-radius: 16px; display: flex; flex-direction: column; border: 1.5px solid transparent;
          background: linear-gradient(#fff, #fff) padding-box, ${T.grad} border-box;
          max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); min-width: min(700px, calc(100vw - 32px));
          box-shadow: 0 18px 50px rgba(120,50,40,.35);
        }
        .bar { display: flex; align-items: center; gap: 6px; padding: 10px 12px; flex-wrap: wrap; }
        .top { border-bottom: 1px solid #f3e6e0; }
        .bottom { border-top: 1px solid #f3e6e0; }
        .grp { display: inline-flex; gap: 2px; background: #fcf4f0; border-radius: 9px; padding: 3px; }
        .sep { width: 1px; height: 22px; background: #f0ddd5; margin: 0 4px; }
        .flex { flex: 1; }
        button {
          all: unset; cursor: pointer; display: inline-grid; place-items: center;
          color: ${T.inkSoft}; border-radius: 8px; min-width: 32px; height: 32px; padding: 0 6px;
          font: 650 12.5px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
        }
        button:hover { background: #f9e6dd; color: ${T.ink}; }
        button.on { background: ${T.btnGrad}; color: #fff; }
        button:disabled { opacity: .35; cursor: default; background: none; }
        button.txt { padding: 0 14px; background: #fbefe9; color: ${T.ink}; }
        button.txt:hover { background: #f7e2d8; }
        button.primary { background: ${T.btnGrad}; color: #fff; }
        button.primary:hover { background: ${T.btnGrad}; filter: brightness(1.05); }
        button.attn { box-shadow: 0 0 0 2px ${T.accent}; }
        .dot { min-width: 26px; width: 26px; height: 26px; padding: 0; }
        .dot i { width: 16px; height: 16px; border-radius: 50%; display: block; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
        .dot.on { background: none; box-shadow: none; }
        .dot.on i { box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px ${T.accent}; }
        .size i { background: ${T.inkSoft}; border-radius: 50%; display: block; }
        .size.on i { background: #fff; }
        .seg button { height: 28px; padding: 0 11px; }
        .seg button.on { background: #fff; color: ${T.ink}; box-shadow: 0 0 0 1px #f0d6cb; }
        .sw { display: inline-flex; gap: 6px; margin-left: 4px; }
        .sw button { min-width: 18px; width: 18px; height: 18px; padding: 0; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(255,255,255,.6), 0 1px 3px rgba(0,0,0,.15); }
        .sw button.on { box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px ${T.accent}; }
        .sw.hide { display: none; }
        .status { color: ${T.inkSoft}; font-size: 12px; margin-left: 8px; white-space: nowrap; }
        .status.ok { color: ${T.deep}; font-weight: 600; }
        .stage {
          flex: 1; min-height: 0; overflow: auto; display: grid; place-items: center; padding: 18px;
          background: #faf5f2;
        }
        .frame { position: relative; box-shadow: 0 0 0 1px rgba(0,0,0,.08); }
        .frame canvas { position: absolute; display: block; }
        .ink { cursor: crosshair; touch-action: none; }
      </style>
      <div class="backdrop">
        <div class="panel" role="dialog" aria-label="Edit screenshot">
          <div class="bar top">
            <div class="grp tools">${TOOLS.map((t) => `<button data-tool="${t.id}" title="${t.label}">${t.icon}</button>`).join("")}</div>
            <span class="sep"></span>
            <div class="grp colors">${COLORS.map((c) => `<button class="dot" data-color="${c}" title="${c}"><i style="background:${c}"></i></button>`).join("")}</div>
            <div class="grp sizes">${SIZES.map((s, i) => `<button class="size" data-size="${s}" title="${["Thin", "Medium", "Thick"][i]}"><i style="width:${4 + i * 4}px;height:${4 + i * 4}px"></i></button>`).join("")}</div>
            <span class="sep"></span>
            <button data-act="undo" title="Undo (Ctrl+Z)">${ICON.undo}</button>
            <button data-act="redo" title="Redo (Ctrl+Shift+Z)">${ICON.redo}</button>
            <button data-act="clear" title="Clear all drawings">${ICON.clear}</button>
            <span class="flex"></span>
            <button data-act="close" title="Close (Esc)">${ICON.close}</button>
          </div>
          <div class="stage"><div class="frame"><canvas class="bg"></canvas><canvas class="ink"></canvas></div></div>
          <div class="bar bottom">
            <div class="grp seg"><button data-m="0">Plain</button><button data-m="1">Mockup</button></div>
            <div class="sw">${opts.swatches.map((g, i) => `<button data-w="${i}" title="Wallpaper ${i + 1}" style="background:${g}"></button>`).join("")}</div>
            <span class="status"></span>
            <span class="flex"></span>
            <button data-act="settings" title="Settings">${ICON.gear}</button>
            <button class="txt" data-act="copy" title="Copy (Ctrl+C)">Copy</button>
            <button class="txt" data-act="save" title="Save PNG (Ctrl+S)">Save</button>
            <button class="txt primary" data-act="done" title="Copy and close (Esc)">Done</button>
          </div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);

    const $ = (q) => sr.querySelector(q);
    const $$ = (q) => [...sr.querySelectorAll(q)];
    const backdrop = $(".backdrop"), stage = $(".stage"), frame = $(".frame");
    const bg = $(".bg"), ink = $(".ink"), status = $(".status");
    const ictx = ink.getContext("2d");

    function setStatus(text, ok) {
      status.textContent = text;
      status.classList.toggle("ok", !!ok);
    }
    function markDirty() {
      dirty = true;
      $('[data-act="copy"]').classList.add("attn");
      setStatus("Edited · not copied yet");
    }
    function markCopied() {
      dirty = false;
      $('[data-act="copy"]').classList.remove("attn");
      setStatus("Copied to clipboard ✓", true);
    }

    // ---------- layout ----------
    function layout() {
      const u = result.u || 1;
      const natW = result.width / u, natH = result.height / u;
      const topH = $(".top").offsetHeight, botH = $(".bottom").offsetHeight;
      const maxW = Math.min(window.innerWidth - 32 - 48, 1600); // panel margin + stage padding + border
      const maxH = window.innerHeight - 32 - topH - botH - 32;
      const k = Math.max(0.05, Math.min(maxW / natW, maxH / natH, 1));
      const w = Math.round(natW * k), h = Math.round(natH * k);
      frame.style.width = w + "px";
      frame.style.height = h + "px";
      const dpr = window.devicePixelRatio || 1;
      Object.assign(bg.style, { left: 0, top: 0, width: w + "px", height: h + "px" });
      bg.width = Math.round(w * dpr);
      bg.height = Math.round(h * dpr);
      Object.assign(ink.style, {
        left: (result.contentX / u) * k + "px",
        top: (result.contentY / u) * k + "px",
        width: (result.plainW / u) * k + "px",
        height: (result.plainH / u) * k + "px",
      });
      if (ink.width !== result.plainW || ink.height !== result.plainH) {
        ink.width = result.plainW;
        ink.height = result.plainH;
      }
      redraw();
    }

    let bgBmp = null;
    async function showResult(res) {
      result = { ...result, ...res };
      const bmp = await createImageBitmap(b64ToBlob(result.base64));
      bgBmp?.close();
      bgBmp = bmp;
      layout();
      paintBg();
    }
    function paintBg() {
      if (!bgBmp) return;
      const g = bg.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.clearRect(0, 0, bg.width, bg.height);
      g.drawImage(bgBmp, 0, 0, bg.width, bg.height);
    }

    // ---------- drawing ----------
    function lw(s) { return s * (result.u || 1); }

    function drawShape(g, s) {
      g.save();
      g.lineCap = "round";
      g.lineJoin = "round";
      g.strokeStyle = g.fillStyle = s.color;
      if (s.type === "pen" || s.type === "hl") {
        if (s.type === "hl") { g.globalAlpha = 0.38; g.lineWidth = lw(s.size) * 4; g.lineCap = "square"; }
        else g.lineWidth = lw(s.size);
        const p = s.pts;
        g.beginPath();
        g.moveTo(p[0][0], p[0][1]);
        if (p.length === 1) g.lineTo(p[0][0] + 0.01, p[0][1]);
        for (let i = 1; i < p.length - 1; i++) {
          const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
          g.quadraticCurveTo(p[i][0], p[i][1], mx, my);
        }
        if (p.length > 1) g.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
        g.stroke();
      } else if (s.type === "arrow") {
        const [x0, y0, x1, y1] = s.box;
        const w = lw(s.size);
        const ang = Math.atan2(y1 - y0, x1 - x0);
        const head = Math.max(lw(10), w * 4);
        const bx = x1 - Math.cos(ang) * head * 0.8, by = y1 - Math.sin(ang) * head * 0.8;
        g.lineWidth = w;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(bx, by); g.stroke();
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x1 - head * Math.cos(ang - 0.45), y1 - head * Math.sin(ang - 0.45));
        g.lineTo(x1 - head * Math.cos(ang + 0.45), y1 - head * Math.sin(ang + 0.45));
        g.closePath(); g.fill();
      } else if (s.type === "rect") {
        const [x, y, w, h] = norm(s.box);
        g.lineWidth = lw(s.size);
        g.beginPath(); g.roundRect(x, y, w, h, lw(4)); g.stroke();
      } else if (s.type === "blur") {
        const [x, y, w, h] = norm(s.box).map(Math.round);
        if (w >= 2 && h >= 2) {
          if (plainBmp) {
            const block = Math.max(lw(9), 4);
            const tw = Math.max(1, Math.ceil(w / block)), th = Math.max(1, Math.ceil(h / block));
            const t = new OffscreenCanvas(tw, th);
            const tg = t.getContext("2d");
            tg.imageSmoothingQuality = "high";
            tg.drawImage(plainBmp, x, y, w, h, 0, 0, tw, th);
            g.imageSmoothingEnabled = false;
            g.drawImage(t, 0, 0, tw, th, x, y, w, h);
          } else {
            g.fillStyle = "#111"; g.fillRect(x, y, w, h);
          }
          if (s === drawing) { // outline while dragging
            g.lineWidth = lw(1.5); g.setLineDash([lw(5), lw(4)]); g.strokeStyle = "#fff";
            g.strokeRect(x, y, w, h);
          }
        }
      }
      g.restore();
    }
    function norm([x0, y0, x1, y1]) {
      return [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
    }
    function redraw() {
      ictx.clearRect(0, 0, ink.width, ink.height);
      // blur first so it sits under strokes drawn on top of it
      for (const s of shapes) if (s.type === "blur") drawShape(ictx, s);
      for (const s of shapes) if (s.type !== "blur") drawShape(ictx, s);
      if (drawing) drawShape(ictx, drawing);
      syncButtons();
    }

    function toInk(e) {
      const r = ink.getBoundingClientRect();
      return [(e.clientX - r.left) * (ink.width / r.width), (e.clientY - r.top) * (ink.height / r.height)];
    }
    ink.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      ink.setPointerCapture(e.pointerId);
      const p = toInk(e);
      drawing = (tool === "pen" || tool === "hl")
        ? { type: tool, color: tool === "hl" && color === "#111111" ? "#ffcc00" : color, size, pts: [p] }
        : { type: tool, color, size, box: [p[0], p[1], p[0], p[1]] };
      redraw();
    });
    ink.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = toInk(e);
      if (drawing.pts) drawing.pts.push(p);
      else { drawing.box[2] = p[0]; drawing.box[3] = p[1]; }
      redraw();
    });
    const finish = () => {
      if (!drawing) return;
      const d = drawing;
      drawing = null;
      const tiny = d.box && Math.hypot(d.box[2] - d.box[0], d.box[3] - d.box[1]) < lw(4);
      if (!tiny) {
        shapes.push(d);
        redoStack = [];
        markDirty();
      }
      redraw();
    };
    ink.addEventListener("pointerup", finish);
    ink.addEventListener("pointercancel", finish);

    function undo() { if (shapes.length) { redoStack.push(shapes.pop()); markDirty(); redraw(); } }
    function redo() { if (redoStack.length) { shapes.push(redoStack.pop()); markDirty(); redraw(); } }
    function clearAll() { if (shapes.length) { redoStack = shapes.reverse(); shapes = []; markDirty(); redraw(); } }

    function syncButtons() {
      $$("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === tool));
      $$("[data-color]").forEach((b) => b.classList.toggle("on", b.dataset.color === color));
      $$("[data-size]").forEach((b) => b.classList.toggle("on", +b.dataset.size === size));
      $('[data-act="undo"]').disabled = !shapes.length;
      $('[data-act="redo"]').disabled = !redoStack.length;
      $('[data-act="clear"]').disabled = !shapes.length;
      $$(".seg button").forEach((b) => b.classList.toggle("on", (b.dataset.m === "1") === !!style.mockup));
      $$(".sw button").forEach((b) => b.classList.toggle("on", +b.dataset.w === style.wallpaper));
      $(".sw").classList.toggle("hide", !style.mockup);
    }

    // ---------- output ----------
    async function exportBlob() {
      const overlay = shapes.length
        ? await blobToB64(await new Promise((r) => ink.toBlob(r, "image/png")))
        : null;
      const res = await send("snap:render", { style, overlay });
      return b64ToBlob(res.base64);
    }
    // Must be called from a click/keypress so the clipboard accepts it.
    function copy() {
      const p = exportBlob();
      let clip;
      try { clip = navigator.clipboard.write([new ClipboardItem({ "image/png": p })]); }
      catch (e) { clip = Promise.reject(e); }
      setStatus("Copying…");
      return clip.then(
        () => { markCopied(); return true; },
        () => { setStatus("Clipboard blocked on this page · use Save"); return false; }
      );
    }
    async function save() {
      if (busy) return;
      busy = true;
      setStatus("Saving…");
      try {
        await exportBlob();               // makes this exact image the one to save
        await send("snap:download");
        setStatus("Saved to Downloads › Grabit ✓", true);
      } catch (e) {
        setStatus(String(e?.message || e));
      } finally { busy = false; }
    }
    async function restyle(patch) {
      style = { ...style, ...patch };
      syncButtons();
      setStatus("Updating…");
      try {
        await showResult(await send("snap:render", { style }));
        markDirty();
      } catch (e) { setStatus(String(e?.message || e)); }
    }
    function done() {
      if (dirty) copy().then((ok) => { if (ok) close(); });
      else close();
    }

    // ---------- events ----------
    $$("[data-tool]").forEach((b) => b.addEventListener("click", () => { tool = b.dataset.tool; syncButtons(); }));
    $$("[data-color]").forEach((b) => b.addEventListener("click", () => { color = b.dataset.color; syncButtons(); }));
    $$("[data-size]").forEach((b) => b.addEventListener("click", () => { size = +b.dataset.size; syncButtons(); }));
    $$(".seg button").forEach((b) => b.addEventListener("click", () => restyle({ mockup: b.dataset.m === "1" })));
    $$(".sw button").forEach((b) => b.addEventListener("click", () => restyle({ wallpaper: +b.dataset.w, mockup: true })));
    const acts = {
      undo, redo, clear: clearAll, close, copy, save, done,
      settings: () => send("snap:openOptions").catch(() => {}),
    };
    $$("[data-act]").forEach((b) => b.addEventListener("click", () => acts[b.dataset.act]()));
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) done(); });
    backdrop.addEventListener("wheel", (e) => { if (!stage.contains(e.composedPath()[0])) e.preventDefault(); }, { passive: false });

    function onKey(e) {
      e.stopPropagation(); // the page never sees keys while the editor is open
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const handled = () => e.preventDefault();
      if (e.key === "Escape") { handled(); done(); }
      else if (mod && k === "z" && !e.shiftKey) { handled(); undo(); }
      else if (mod && (k === "y" || (k === "z" && e.shiftKey))) { handled(); redo(); }
      else if (mod && k === "c") { handled(); copy(); }
      else if (mod && k === "s") { handled(); save(); }
      else if (!mod && !e.altKey) {
        const t = TOOLS.find((t) => t.key === k);
        if (t) { handled(); tool = t.id; syncButtons(); }
      }
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", stopKey, true);
    window.addEventListener("keypress", stopKey, true);
    function stopKey(e) { e.stopPropagation(); }
    window.addEventListener("resize", onResize);
    function onResize() { layout(); paintBg(); }

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", stopKey, true);
      window.removeEventListener("keypress", stopKey, true);
      window.removeEventListener("resize", onResize);
      if (current === api) current = null;
      bgBmp?.close();
      plainBmp?.close?.();
      host.remove();
    }
    const api = { close };
    current = api;

    // ---------- start ----------
    if (opts.copied) markCopied();
    else setStatus(opts.autoCopy ? "Clipboard blocked on this page · use Save" : "Not copied · press Copy");
    syncButtons();
    showResult(result);
    if (result.plainBase64) {
      createImageBitmap(b64ToBlob(result.plainBase64)).then((b) => { plainBmp = b; redraw(); }, () => {});
    }
  }

  window.__snapEditor = { open, close: () => current?.close() };
})();
