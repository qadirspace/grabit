// Grabit — content script.
// Injected on demand (toolbar click / Alt+Shift+S). Running it again toggles the picker.
(() => {
  if (window.__snapCapture) {
    window.__snapCapture.toggle();
    return;
  }

  const Z = "2147483647";
  const T = {
    accent: "#f2704f", deep: "#d4532f", ink: "#2a2230", inkSoft: "#6d6370",
    // brand gradient, sampled from the icon: orange → coral → rose → sky
    grad: "linear-gradient(120deg, #ff9a4f 0%, #ff7a66 40%, #ea86a6 72%, #8fabd4 100%)",
    btnGrad: "linear-gradient(135deg, #ff9a4f 0%, #f56f5b 55%, #e5809f 100%)",
  };
  const MAX_CAPTURE_CSS_HEIGHT = 20000; // safety cap for very tall elements
  // Custom arrow cursor. Hotspot (6, 4) is the arrow's tip.
  // The extension file is tried first (not affected by page CSP); the inline copy is a fallback.
  const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="m9.448 3.487 10.887 8.989a1.82 1.82 0 0 1-1.168 3.224h-3.91a3.67 3.67 0 0 0-2.927 1.454l-2.356 3.117a1.83 1.83 0 0 1-3.288-1.007L6 5.2a2.1 2.1 0 0 1 3.448-1.713" fill="#000" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  let cursorFileUrl = "";
  try { cursorFileUrl = chrome.runtime.getURL("icons/cursor.svg"); } catch { /* not in an extension (test page) */ }
  const CURSOR = [
    cursorFileUrl && `url("${cursorFileUrl}") 6 4`,
    `url("data:image/svg+xml,${encodeURIComponent(CURSOR_SVG)}") 6 4`,
    "default",
  ].filter(Boolean).join(", ");
  const REPLACED = new Set(["IMG", "VIDEO", "CANVAS", "SVG", "PICTURE", "IFRAME", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "EMBED", "OBJECT"]);

  let active = false;
  let busy = false;
  let host, root, catcher, box, label, selRect;
  let baseEl = null;   // element directly under the pointer (normalized)
  let target = null;   // element currently highlighted (the "box" around baseEl)
  let childStack = []; // path from target down toward the pointer, for ↓
  let manual = false;  // user adjusted the selection with ↑/↓ — keep it while inside it
  let lastX = -1, lastY = -1;
  let dragStart = null, dragging = false;
  let toastHost = null, toastTimer = null;

  // Settings (edited on the Options page). Defaults: open the editor, auto-copy,
  // Mac mockup on, Bg-1.jpg wallpaper (index 4 in mockup.js).
  // afterCapture: "copy" (default: copy + confirmation effect only) | "editor" | "toast"
  const DEFAULTS = { afterCapture: "copy", autoCopy: true, mockup: true, wallpaper: 4 };
  let settings = { ...DEFAULTS };
  let style = { mockup: settings.mockup, wallpaper: settings.wallpaper }; // style for the current capture
  // Swatches mirror the wallpapers in mockup.js.
  const SWATCHES = [
    "linear-gradient(135deg,#4b2a8c,#ff5fa2 60%,#ffb35c)",
    "linear-gradient(135deg,#06275c,#21d4fd 55%,#2af598)",
    "linear-gradient(135deg,#ffd86b,#ff7a59 45%,#ff2e93)",
    "linear-gradient(135deg,#1c1d22,#5a6275 60%,#2f3138)",
    // photo wallpapers (Bg-1.jpg, Bg-2.jpg): colour-matched gradients, safe on any site
    "linear-gradient(160deg,#1a8fe0 0 28%,#ffb21e 38%,#ff3b4a 55%,#c2187a 80%,#5b3a8a)",
    "linear-gradient(160deg,#e9efe6 0 25%,#7f9c6c 50%,#c9874a 75%,#5e7a4e)",
  ];
  try {
    chrome.storage?.local.get("settings").then((r) => { if (r?.settings) settings = { ...DEFAULTS, ...r.settings }; }, () => {});
    chrome.storage?.onChanged.addListener((ch, area) => {
      if (area === "local" && ch.settings) settings = { ...DEFAULTS, ...ch.settings.newValue };
    });
  } catch { /* storage unavailable (test page) */ }

  // ---------- picker UI ----------

  function start() {
    if (active || busy) return;
    active = true;
    resetCaches();
    window.__snapEditor?.close();
    hideToast();
    buildPicker();
  }

  function buildPicker() {
    host = document.createElement("div");
    host.setAttribute("data-snap-capture", "");
    host.style.cssText = `all:initial;position:fixed;inset:0;z-index:${Z};`;
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .catcher { position: fixed; inset: 0; cursor: ${CURSOR}; background: transparent; }
        .box, .sel {
          position: fixed; pointer-events: none; display: none; box-sizing: border-box;
          border: 2px solid ${T.accent}; border-radius: 6px; background: rgba(255,122,89,0.08);
        }
        .sel { border-style: dashed; }
        .label {
          position: fixed; pointer-events: none; display: none;
          background: ${T.grad}; color: #fff; border-radius: 999px;
          font: 600 11px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
          padding: 2px 9px; text-shadow: 0 1px 1px rgba(120,40,30,.25); white-space: nowrap; max-width: 60vw;
          overflow: hidden; text-overflow: ellipsis;
        }
      </style>
      <div class="catcher"></div>
      <div class="box"></div>
      <div class="label"></div>
      <div class="sel"></div>`;
    catcher = root.querySelector(".catcher");
    box = root.querySelector(".box");
    label = root.querySelector(".label");
    selRect = root.querySelector(".sel");

    document.documentElement.appendChild(host);

    catcher.addEventListener("mousemove", onMove);
    catcher.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp, true);
    catcher.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
  }

  function stop() {
    if (!active) return;
    active = false;
    window.removeEventListener("mouseup", onUp, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    cancelAnimationFrame(moveRaf);
    moveRaf = 0;
    lastPaint = "";
    host?.remove();
    host = root = catcher = box = label = selRect = null;
    baseEl = target = null;
    childStack = [];
    manual = false;
    dragStart = null;
    dragging = false;
  }

  function isOurs(el) {
    return el === host || el === toastHost;
  }

  function pickAt(x, y) {
    const els = document.elementsFromPoint(x, y);
    const el = els.find((e) => !isOurs(e));
    return el ? normalize(el) : null;
  }

  // ---------- style caches ----------
  // While the picker is up, the page sits under our overlay (no :hover changes),
  // so an element's look is stable. Cache what we learn about each element
  // for the session instead of re-reading styles on every mouse move.
  let csCache = new WeakMap(), paintCache = new WeakMap(), bgCache = new WeakMap();
  function resetCaches() { csCache = new WeakMap(); paintCache = new WeakMap(); bgCache = new WeakMap(); }
  function css(el) {
    let c = csCache.get(el);
    if (!c) { c = getComputedStyle(el); csCache.set(el, c); }
    return c;
  }

  // Climb from the raw hit element to something worth capturing.
  function normalize(el) {
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) {
      el = el.ownerSVGElement || el;
      while (el.ownerSVGElement) el = el.ownerSVGElement;
    }
    while (el && el !== document.body && el !== document.documentElement && el.parentElement) {
      const tag = el.tagName.toUpperCase();
      const r = el.getBoundingClientRect();
      if (!REPLACED.has(tag)) {
        const d = css(el).display;
        if (d === "contents") { el = el.parentElement; continue; }
        // plain inline text climbs to its block; an inline badge/pill/tag with its own
        // background, border or shadow is a detail worth picking on its own
        if (d === "inline" && !(paints(el) && r.width >= 8 && r.height >= 8)) { el = el.parentElement; continue; }
      }
      if (r.width < 6 || r.height < 6) { el = el.parentElement; continue; }
      break;
    }
    return el;
  }

  // ---------- smart "box" detection ----------
  // From the element under the pointer, walk up to the nearest ancestor that
  // *looks* like a box on screen: a border or divider line, a real shadow,
  // an outline, its own background, a line right above/below it, a card drawn
  // by ::before/::after, a list item, a button, media… That's what gets highlighted.

  const MEDIA = new Set(["IMG", "VIDEO", "CANVAS", "SVG", "PICTURE", "IFRAME", "EMBED", "OBJECT"]);
  const SEMANTIC_BOX = new Set(["LI", "ARTICLE", "TR", "TD", "TH", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "FIGURE", "PRE", "BLOCKQUOTE", "TABLE", "DETAILS", "DIALOG", "ASIDE", "NAV", "HEADER", "FOOTER", "SECTION", "FORM", "FIELDSET", "LABEL", "CODE", "KBD", "MARK"]);
  const BOX_ROLES = new Set(["button", "listitem", "row", "article", "dialog", "tab", "menuitem", "option", "gridcell", "cell", "region", "navigation", "banner", "toolbar", "alert", "status", "img", "figure", "tooltip"]);

  function alphaOf(color) {
    if (!color || color === "transparent") return 0;
    const slash = color.match(/\/\s*([\d.]+%?)\s*\)/);
    if (slash) return slash[1].endsWith("%") ? parseFloat(slash[1]) / 100 : parseFloat(slash[1]);
    const m = color.match(/^rgba\(([^)]+)\)/);
    if (m) return parseFloat(m[1].split(",")[3]);
    return 1;
  }

  // The colour actually showing behind an element (first non-transparent ancestor).
  function effectiveBg(el) {
    if (!el) return "rgb(255, 255, 255)";
    let v = bgCache.get(el);
    if (v === undefined) {
      const bg = css(el).backgroundColor;
      v = alphaOf(bg) > 0.05 ? bg : effectiveBg(el.parentElement);
      bgCache.set(el, v);
    }
    return v;
  }

  function borderSides(cs) {
    let n = 0;
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      if (parseFloat(cs[`border${side}Width`]) >= 1 &&
          cs[`border${side}Style`] !== "none" && cs[`border${side}Style`] !== "hidden" &&
          alphaOf(cs[`border${side}Color`]) > 0.05) n++;
    }
    return n;
  }

  // A shadow you can actually see. Many sites set "rgba(0,0,0,0) 0 0 0 0" or
  // "0 0 #0000" on everything; those don't count.
  function visibleShadow(v) {
    if (!v || v === "none") return false;
    for (const part of v.split(/,(?![^(]*\))/)) {
      const color = (part.match(/rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}\b/i) || ["rgb(0, 0, 0)"])[0];
      if (alphaOf(color) < 0.04) continue;
      const lengths = (part.replace(/(rgba?|hsla?)\([^)]*\)/g, "").match(/-?[\d.]+px/g) || []).map(parseFloat);
      if (lengths.some((n) => Math.abs(n) >= 0.5)) return true;
    }
    return false;
  }

  // Does this element paint a visible edge or surface of its own?
  // (style-only, so it's cached per element)
  function paints(el) {
    let v = paintCache.get(el);
    if (v !== undefined) return v;
    const cs = css(el);
    v = borderSides(cs) > 0 ||
      visibleShadow(cs.boxShadow) ||
      /drop-shadow\(/.test(cs.filter) ||
      (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1 && alphaOf(cs.outlineColor) > 0.05) ||
      (cs.backgroundImage && cs.backgroundImage !== "none") ||
      (alphaOf(cs.backgroundColor) > 0.05 && cs.backgroundColor !== effectiveBg(el.parentElement));
    paintCache.set(el, v);
    return v;
  }

  // Cards are often drawn by an absolutely positioned ::before/::after
  // (a background, border or shadow layer behind the content).
  function pseudoSurface(el, r) {
    for (const which of ["::before", "::after"]) {
      const p = getComputedStyle(el, which);
      if (p.content === "none" || p.content === "normal") continue;
      if (p.position !== "absolute" && p.position !== "fixed") continue;
      const paintsIt = alphaOf(p.backgroundColor) > 0.05 || (p.backgroundImage && p.backgroundImage !== "none") ||
        borderSides(p) > 0 || visibleShadow(p.boxShadow);
      if (paintsIt && parseFloat(p.width) >= r.width * 0.8 && parseFloat(p.height) >= r.height * 0.8) return true;
    }
    return false;
  }

  // A thin line element (<hr>, a 1px divider div, a rule) right above, below
  // or beside this element marks its edge, even though the line isn't part of it.
  function isLine(n) {
    if (n.tagName === "HR") return true;
    const cs = css(n);
    return alphaOf(cs.backgroundColor) > 0.05 || (cs.backgroundImage && cs.backgroundImage !== "none") || borderSides(cs) > 0;
  }
  function hasDividerNeighbour(el, r) {
    for (const n of [el.previousElementSibling, el.nextElementSibling]) {
      if (!n || isOurs(n)) continue;
      const s = n.getBoundingClientRect();
      const horizontal = s.height > 0 && s.height <= 4 && s.width >= r.width * 0.6 &&
        (Math.abs(s.top - r.bottom) <= 16 || Math.abs(r.top - s.bottom) <= 16);
      const vertical = s.width > 0 && s.width <= 4 && s.height >= r.height * 0.6 &&
        (Math.abs(s.left - r.right) <= 16 || Math.abs(r.left - s.right) <= 16);
      if ((horizontal || vertical) && isLine(n)) return true;
    }
    return false;
  }

  function isBox(el, r) {
    const tag = el.tagName.toUpperCase();
    if (MEDIA.has(tag)) return r.width >= 12 && r.height >= 12;
    if (r.width < 12 || r.height < 10) return false;
    if (SEMANTIC_BOX.has(tag)) return true;
    const role = el.getAttribute("role");
    if (role && BOX_ROLES.has(role)) return true;
    if (paints(el)) return true;
    if (isRepeatedItem(el)) return true;
    if (hasDividerNeighbour(el, r)) return true;
    return pseudoSurface(el, r);
  }

  // Rows/cards in a list usually share tag + class with their siblings,
  // even when the first one has no divider of its own.
  function isRepeatedItem(el) {
    const p = el.parentElement;
    if (!p || p.children.length < 2) return false;
    const cls = typeof el.className === "string" ? el.className.trim() : "";
    for (const s of p.children) {
      if (s !== el && s.tagName === el.tagName &&
          (typeof s.className === "string" ? s.className.trim() : "") === cls) return true;
    }
    return false;
  }

  // Page-sized wrappers aren't useful hover targets.
  function tooBig(r) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    return r.width >= vw * 0.97 && r.height >= vh * 0.85;
  }

  function sameRect(a, b) {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return Math.abs(ra.left - rb.left) < 1.5 && Math.abs(ra.top - rb.top) < 1.5 &&
           Math.abs(ra.width - rb.width) < 1.5 && Math.abs(ra.height - rb.height) < 1.5;
  }

  // Returns { box, path } where path lists the visibly-distinct elements between
  // the hovered element and the box (nearest-to-box last, so pop() steps inward).
  function findBox(el) {
    const chain = [];
    let box = null;
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const r = n.getBoundingClientRect();
      if (tooBig(r)) break;
      if (isBox(n, r)) { box = n; break; }
      chain.push(n);
    }
    if (!box) return { box: el, path: [] };
    const path = [];
    let upper = box;
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = chain[i];
      const r = n.getBoundingClientRect();
      if (r.width < 6 || r.height < 6 || sameRect(n, upper)) continue;
      path.unshift(n);
      upper = n;
    }
    return { box, path };
  }

  function updateFromPoint(x, y) {
    const el = pickAt(x, y);
    if (el === baseEl) return;
    baseEl = el;
    if (!el) { target = null; childStack = []; return; }
    // Keep a hand-tuned selection while the pointer stays inside it.
    if (manual && target && target.contains(el)) return;
    manual = false;
    const { box, path } = findBox(el);
    target = box;
    childStack = path;
  }

  let lastPaint = "";
  function hideHighlight() {
    box.style.display = label.style.display = "none";
    lastPaint = "";
  }

  function render() {
    if (!active || !box) return;
    if (!target || dragging) { hideHighlight(); return; }
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const r = target.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    const w = Math.min(vw, r.right) - x, h = Math.min(vh, r.bottom) - y;
    if (w <= 0 || h <= 0) { hideHighlight(); return; }

    // nothing moved: don't touch the DOM
    const key = `${x},${y},${w},${h}`;
    if (key === lastPaint && box.style.display === "block") return;
    lastPaint = key;
    Object.assign(box.style, { display: "block", left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
    label.textContent = `Screenshot · ${Math.round(r.width)} × ${Math.round(r.height)}`;
    const lh = 20, above = y >= lh + 4;
    Object.assign(label.style, {
      display: "block",
      left: Math.max(0, Math.min(x + (above ? 0 : 4), vw - 120)) + "px",
      top: (above ? y - lh - 4 : y + 4) + "px",
    });
  }

  function onMove(e) {
    lastX = e.clientX;
    lastY = e.clientY;
    if (dragStart) {
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (!dragging && Math.hypot(dx, dy) > 5) dragging = true;
      if (dragging) {
        const r = dragRect(e.clientX, e.clientY);
        Object.assign(selRect.style, {
          display: "block",
          left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px",
        });
        render();
        return;
      }
    }
    // Mice can fire several moves per frame; detect once per frame with the latest position.
    if (!moveRaf) moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      if (!active || dragging) return;
      updateFromPoint(lastX, lastY);
      render();
    });
  }
  let moveRaf = 0;

  function dragRect(x, y) {
    const x1 = Math.min(dragStart.x, x), y1 = Math.min(dragStart.y, y);
    return { x: x1, y: y1, w: Math.abs(x - dragStart.x), h: Math.abs(y - dragStart.y) };
  }

  function onDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragStart = { x: e.clientX, y: e.clientY };
    dragging = false;
  }

  function onUp(e) {
    if (!active || !dragStart || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (dragging) {
      const r = dragRect(e.clientX, e.clientY);
      dragStart = null;
      dragging = false;
      if (r.w >= 4 && r.h >= 4) startCapture({ region: r });
      else { selRect.style.display = "none"; render(); }
    } else {
      dragStart = null;
      if (target) startCapture({ element: target });
    }
  }

  function goParent() {
    if (!target || target === document.body || target === document.documentElement) return;
    let p = target.parentElement;
    // skip wrappers that occupy exactly the same area — every ↑ should visibly grow
    while (p && p !== document.body && sameRect(p, target)) p = p.parentElement;
    if (!p || p === document.documentElement) return;
    childStack.push(target);
    target = p;
    manual = true;
    render();
  }

  function goChild() {
    if (!target) return;
    let next = childStack.pop();
    if (!next) {
      // Nothing recorded: step into the child under the pointer (or the first sizable one).
      const kids = [...target.children].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width >= 6 && r.height >= 6 && !isOurs(c);
      });
      next = kids.find((c) => {
        const r = c.getBoundingClientRect();
        return lastX >= r.left && lastX <= r.right && lastY >= r.top && lastY <= r.bottom;
      }) || kids[0];
      while (next && next.children.length === 1 && sameRect(next, next.children[0])) next = next.children[0];
      if (!next) return;
    }
    target = next;
    manual = true;
    render();
  }

  function onWheel(e) {
    if (!e.altKey) return; // plain wheel scrolls the page as usual
    e.preventDefault();
    if (e.deltaY < 0) goParent();
    else if (e.deltaY > 0) goChild();
  }

  function onKey(e) {
    if (!active) return;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    switch (e.key) {
      case "Escape": handled(); stop(); break;
      case "ArrowUp": handled(); goParent(); break;
      case "ArrowDown": handled(); goChild(); break;
      case "Enter":
        handled();
        if (target) startCapture({ element: target });
        break;
    }
  }

  let scrollRaf = 0;
  function onScroll() {
    if (!active || scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (!active) return;
      if (lastX >= 0 && !dragging) updateFromPoint(lastX, lastY);
      render();
    });
  }

  // ---------- capture ----------

  // Must be called synchronously inside the click/keypress so the clipboard
  // write is tied to the user gesture. The PNG is produced asynchronously.
  function startCapture(job) {
    if (busy) return;
    busy = true;
    style = { mockup: settings.mockup, wallpaper: settings.wallpaper };
    const useEditor = settings.afterCapture === "editor" && !!window.__snapEditor;
    const useToast = settings.afterCapture === "toast";
    const copyOnly = !useEditor && !useToast;
    // where the capture is on screen (for the confirmation effect)
    const rect = job.region
      ? { left: job.region.x, top: job.region.y, width: job.region.w, height: job.region.h }
      : (() => { const r = job.element.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })();
    const resultPromise = runCapture(job, useEditor);
    const pngPromise = resultPromise.then((r) => base64ToBlob(r.base64, "image/png"));

    let clip;
    if (settings.autoCopy || copyOnly) {
      try {
        clip = navigator.clipboard.write([new ClipboardItem({ "image/png": pngPromise })]);
      } catch (err) {
        clip = Promise.reject(err);
      }
    } else {
      clip = Promise.reject(new Error("auto-copy off"));
    }
    clip.catch(() => {}); // handled below

    Promise.all([resultPromise, pngPromise]).then(
      async ([result, blob]) => {
        const copied = await clip.then(() => true, () => false);
        busy = false;
        if (useEditor) {
          window.__snapEditor.open({ result, style, copied, autoCopy: settings.autoCopy, swatches: SWATCHES, send });
        } else if (copyOnly && copied) {
          // copied: briefly outline the captured area as confirmation
          doneEffect(rect);
        } else {
          // quick-preview mode, or the clipboard was blocked: show the card (it has Save)
          showToast({ blob, copied });
        }
      },
      (err) => {
        busy = false;
        showToast({ error: String(err?.message || err) });
      }
    );
  }

  // Confirmation after a copy: a plain outline on the captured area for a moment.
  function doneEffect(rect) {
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const l = Math.max(0, rect.left), t = Math.max(0, rect.top);
    const r = Math.min(vw, rect.left + rect.width), b = Math.min(vh, rect.top + rect.height);
    if (r <= l || b <= t) return;
    const fx = document.createElement("div");
    fx.setAttribute("data-snap-capture", "");
    fx.style.cssText = `all:initial;position:fixed;z-index:${Z};pointer-events:none;box-sizing:border-box;` +
      `left:${l}px;top:${t}px;width:${r - l}px;height:${b - t}px;border:2px solid ${T.accent};border-radius:6px;`;
    document.documentElement.appendChild(fx);
    setTimeout(() => fx.remove(), 400);
  }

  let includePlain = false;
  async function runCapture(job, forEditor) {
    includePlain = !!forEditor;
    stop(); // remove the overlay before taking pictures
    hideToast();
    window.__snapEditor?.close();
    await send("snap:begin");
    await nextPaint(); // the overlay must be gone from the screen before the first frame

    let result;
    if (job.region) {
      const r = job.region;
      const f = await send("snap:captureFrame");
      result = await send("snap:compose", {
        width: r.w, height: r.h, viewportWidth: window.innerWidth,
        specs: [{ frame: f.index, sx: r.x, sy: r.y, sw: r.w, sh: r.h, dx: 0, dy: 0 }],
        style, includePlain,
      });
    } else {
      result = await captureElement(job.element);
    }
    return result;
  }

  async function captureElement(el) {
    if (!el.isConnected) throw new Error("That element is no longer on the page.");
    const scroller = findScroller(el);
    const isDoc = scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;

    const saved = {
      winX: window.scrollX, winY: window.scrollY,
      top: scroller.scrollTop, left: scroller.scrollLeft,
      behaviors: [],
    };
    for (const n of new Set([document.documentElement, document.body, scroller])) {
      if (!n) continue;
      saved.behaviors.push([n, n.style.getPropertyValue("scroll-behavior"), n.style.getPropertyPriority("scroll-behavior")]);
      n.style.setProperty("scroll-behavior", "auto", "important");
    }

    const getPos = () => (isDoc ? window.scrollY : scroller.scrollTop);
    const startPos = getPos();
    const scrollByY = (d) => {
      if (isDoc) window.scrollBy(0, d);
      else scroller.scrollTop += d;
    };
    const viewport = () => {
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const v = { top: 0, bottom: vh, left: 0, right: vw };
      if (!isDoc) {
        const sr = scroller.getBoundingClientRect();
        const t = sr.top + scroller.clientTop, l = sr.left + scroller.clientLeft;
        v.top = Math.max(v.top, t);
        v.bottom = Math.min(v.bottom, t + scroller.clientHeight);
        v.left = Math.max(v.left, l);
        v.right = Math.min(v.right, l + scroller.clientWidth);
      }
      return v;
    };

    let hidden = [];
    try {
      let r = el.getBoundingClientRect();
      let vp = viewport();
      const vpH = vp.bottom - vp.top;
      const capH = Math.min(r.height, MAX_CAPTURE_CSS_HEIGHT);
      if (r.width < 1 || capH < 1) throw new Error("That element has no visible size.");
      const needsStitch = capH > vpH + 0.5;

      // Bring the element (or its top, if tall) into view.
      if (!needsStitch) {
        if (r.top < vp.top) scrollByY(r.top - vp.top);
        else if (r.bottom > vp.bottom) scrollByY(r.bottom - vp.bottom);
      } else if (Math.abs(r.top - vp.top) > 0.5) {
        scrollByY(r.top - vp.top);
      }
      if (needsStitch) hidden = hideFloaters(el);
      if (needsStitch || getPos() !== startPos) await settle();

      r = el.getBoundingClientRect();
      vp = viewport();
      const clipLeft = Math.max(r.left, vp.left) - r.left; // element coords
      const width = Math.min(r.right, vp.right) - Math.max(r.left, vp.left);
      if (width < 1) throw new Error("That element is outside the visible area.");

      const specs = [];
      let covered = 0;
      for (let i = 0; i < 300; i++) {
        r = el.getBoundingClientRect();
        vp = viewport();
        const sliceTop = Math.max(r.top, vp.top);
        const sliceBottom = Math.min(r.bottom, vp.bottom, r.top + capH);
        if (sliceBottom <= sliceTop) break;

        const from = Math.max(sliceTop - r.top, covered);
        const to = sliceBottom - r.top;
        if (to - from > 0.5) {
          const f = await send("snap:captureFrame");
          specs.push({
            frame: f.index,
            sx: r.left + clipLeft, sy: r.top + from,
            sw: width, sh: to - from,
            dx: 0, dy: from,
          });
          covered = to;
        }
        if (covered >= capH - 0.5) break;

        const before = getPos();
        scrollByY(r.top + covered - vp.top);
        await settle();
        if (Math.abs(getPos() - before) < 0.5) break; // can't scroll any further
      }
      if (!specs.length) throw new Error("Nothing visible to capture.");

      return await send("snap:compose", {
        width, height: covered, viewportWidth: window.innerWidth, specs, style, includePlain,
      });
    } finally {
      restoreFloaters(hidden);
      if (isDoc) window.scrollTo(saved.winX, saved.winY);
      else { scroller.scrollTop = saved.top; scroller.scrollLeft = saved.left; window.scrollTo(saved.winX, saved.winY); }
      for (const [n, v, p] of saved.behaviors) {
        if (v) n.style.setProperty("scroll-behavior", v, p);
        else n.style.removeProperty("scroll-behavior");
      }
    }
  }

  function findScroller(el) {
    let n = el.parentElement;
    while (n && n !== document.body && n !== document.documentElement) {
      const oy = getComputedStyle(n).overflowY;
      if (/(auto|scroll|overlay)/.test(oy) && n.scrollHeight > n.clientHeight + 1) return n;
      n = n.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  // Fixed/sticky headers would repeat in every stitched slice — hide them while stitching.
  function hideFloaters(el) {
    const out = [];
    for (const n of document.body.querySelectorAll("*")) {
      if (isOurs(n) || n.contains(el) || el.contains(n)) continue;
      const cs = getComputedStyle(n);
      if ((cs.position === "fixed" || cs.position === "sticky") && cs.visibility !== "hidden") {
        out.push([n, n.style.getPropertyValue("visibility"), n.style.getPropertyPriority("visibility")]);
        n.style.setProperty("visibility", "hidden", "important");
      }
    }
    return out;
  }

  function restoreFloaters(list) {
    for (const [n, v, p] of list) {
      if (v) n.style.setProperty("visibility", v, p);
      else n.style.removeProperty("visibility");
    }
  }

  // Two frames: the browser has painted whatever we just changed.
  function nextPaint() {
    return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  }

  // After scrolling: also give lazy content / scroll handlers a moment.
  function settle() {
    return new Promise((res) =>
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 60)))
    );
  }

  async function send(type, payload = {}) {
    const res = await chrome.runtime.sendMessage({ type, ...payload });
    if (!res?.ok) throw new Error(res?.error || "Capture failed");
    return res;
  }

  function base64ToBlob(b64, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  // ---------- toast ----------

  function hideToast() {
    clearTimeout(toastTimer);
    toastHost?.remove();
    toastHost = null;
  }

  async function showToast({ blob, copied, error }) {
    hideToast();
    toastHost = document.createElement("div");
    toastHost.setAttribute("data-snap-capture", "");
    toastHost.style.cssText = `all:initial;position:fixed;right:18px;bottom:18px;z-index:${Z};`;
    const sr = toastHost.attachShadow({ mode: "open" });
    sr.innerHTML = `
      <style>
        .t {
          display: flex; gap: 12px; align-items: center;
          color: ${T.ink}; border-radius: 14px; border: 1.5px solid transparent;
          background: linear-gradient(#fff, #fff) padding-box, ${T.grad} border-box;
          padding: 10px; padding-right: 12px; min-width: 300px; max-width: 440px;
          font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
          box-shadow: 0 8px 28px rgba(160,70,50,.24);
        }
        canvas.prev { border-radius: 6px; background: #fff; flex: none; display: block; box-shadow: 0 0 0 1px rgba(0,0,0,.1); }
        .body { flex: 1; min-width: 0; }
        .title { font-weight: 650; }
        .sub { color: ${T.inkSoft}; font-size: 12px; margin-top: 2px; }
        .row { display: flex; gap: 8px; margin-top: 9px; align-items: center; flex-wrap: wrap; }
        button {
          all: unset; cursor: pointer; font: 650 12px/1 system-ui, sans-serif;
          padding: 7px 11px; border-radius: 8px; background: #fbefe9; color: ${T.ink};
        }
        button:hover { background: #f7e2d8; }
        button.primary { background: ${T.btnGrad}; color: #fff; }
        button.primary:hover { filter: brightness(1.05); }
        .x { padding: 4px 7px; align-self: flex-start; background: transparent; color: ${T.inkSoft}; }
        .x:hover { background: #fbefe9; }
        .err .title { color: #c2362b; }
        .seg { display: inline-flex; background: #fbefe9; border-radius: 9px; padding: 2px; }
        .seg button { background: transparent; box-shadow: none; padding: 6px 9px; border-radius: 7px; color: ${T.inkSoft}; }
        .seg button.on { background: #fff; color: ${T.ink}; }
        .sw { display: inline-flex; gap: 5px; }
        .sw button { width: 16px; height: 16px; padding: 0; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(255,255,255,.6), 0 1px 3px rgba(0,0,0,.15); }
        .sw button.on { box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px ${T.accent}; }
        .sw.hide { display: none; }
        .spacer { flex: 1; }
      </style>
      <div class="t ${error ? "err" : ""}">
        ${blob ? '<canvas class="prev" width="1" height="1"></canvas>' : ""}
        <div class="body">
          <div class="title"></div>
          <div class="sub"></div>
          ${blob ? `<div class="row">
            <div class="seg"><button data-m="0">Plain</button><button data-m="1">Mockup</button></div>
            <div class="sw">${SWATCHES.map((g, i) => `<button data-w="${i}" title="Wallpaper ${i + 1}" style="background:${g}"></button>`).join("")}</div>
            <span class="spacer"></span>
            <button class="primary save">Save PNG</button>
          </div>` : ""}
        </div>
        <button class="x" title="Close">✕</button>
      </div>`;
    document.documentElement.appendChild(toastHost);

    const title = sr.querySelector(".title");
    const sub = sr.querySelector(".sub");
    const setCopied = (ok) => {
      title.textContent = ok ? "Copied to clipboard" : "Screenshot ready";
      sub.textContent = ok ? "Paste anywhere, or save as a file." : "Clipboard was blocked on this page. Save it instead.";
    };
    if (error) {
      title.textContent = "Couldn't capture";
      sub.textContent = error;
    } else {
      setCopied(copied);
    }

    sr.querySelector(".x").addEventListener("click", hideToast);
    const saveBtn = sr.querySelector(".save");
    saveBtn?.addEventListener("click", async () => {
      saveBtn.textContent = "Saving…";
      try {
        await send("snap:download");
        saveBtn.textContent = "Saved ✓";
        sub.textContent = "Downloads › Grabit";
      } catch (e) {
        saveBtn.textContent = "Save PNG";
        sub.textContent = String(e?.message || e);
      }
    });

    // Plain / Mockup and wallpaper switches re-render from the stored capture
    // and re-copy (the click itself is the user gesture the clipboard needs).
    const syncControls = () => {
      sr.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", (b.dataset.m === "1") === !!style.mockup));
      sr.querySelectorAll(".sw button").forEach((b) => b.classList.toggle("on", +b.dataset.w === style.wallpaper));
      sr.querySelector(".sw")?.classList.toggle("hide", !style.mockup);
    };
    const restyle = (patch) => {
      style = { ...style, ...patch }; // this capture only; defaults live in Settings
      syncControls();
      if (saveBtn) saveBtn.textContent = "Save PNG";
      const p = send("snap:render", { style }).then((r) => base64ToBlob(r.base64, "image/png"));
      let clip;
      try { clip = navigator.clipboard.write([new ClipboardItem({ "image/png": p })]); }
      catch (e) { clip = Promise.reject(e); }
      p.then(async (b) => {
        drawPreview(b);
        setCopied(await clip.then(() => true, () => false));
      }, (e) => { sub.textContent = String(e?.message || e); });
    };
    sr.querySelectorAll(".seg button").forEach((b) =>
      b.addEventListener("click", () => restyle({ mockup: b.dataset.m === "1" })));
    sr.querySelectorAll(".sw button").forEach((b) =>
      b.addEventListener("click", () => restyle({ wallpaper: +b.dataset.w, mockup: true })));
    syncControls();

    const t = sr.querySelector(".t");
    t.addEventListener("mouseenter", () => clearTimeout(toastTimer));
    t.addEventListener("mouseleave", () => armTimer(3000));
    armTimer(error ? 6000 : 7000);

    async function drawPreview(b) {
      try {
        const bmp = await createImageBitmap(b);
        const canvas = sr.querySelector("canvas.prev");
        const k = Math.min(112 / bmp.width, 80 / bmp.height, 1);
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
        const g = canvas.getContext("2d");
        g.imageSmoothingQuality = "high";
        g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        bmp.close();
      } catch { /* preview is optional */ }
    }
    if (blob) drawPreview(blob);
  }

  function armTimer(ms) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms);
  }

  window.__snapCapture = {
    toggle() { active ? stop() : start(); },
  };
  start();
})();
