// Grabit — macOS-style window mockup renderer.
// Works in the service worker (via importScripts) and in normal pages.
// Wallpapers are generated gradients plus two photos bundled with the extension (Bg-1.jpg, Bg-2.jpg).
(function (g) {
  const WALLPAPERS = [
    { // Dusk: violet / pink / amber
      base: ["#1d1b4f", "#4b2a8c", "#2a1745"],
      blobs: [["#ff5fa2", 0.15, 0.2, 0.65], ["#7b6cff", 0.9, 0.15, 0.6], ["#ffb35c", 0.75, 1.0, 0.6], ["#38d6ff", 0.05, 0.95, 0.5]],
    },
    { // Lagoon: deep blue / teal / mint
      base: ["#06275c", "#0a5c8c", "#04303f"],
      blobs: [["#21d4fd", 0.2, 0.15, 0.6], ["#2af598", 0.95, 0.9, 0.6], ["#3a47d5", 0.85, 0.1, 0.55], ["#00c9a7", 0.1, 1.0, 0.5]],
    },
    { // Sunrise: coral / peach / magenta
      base: ["#ff7a59", "#ff4e7a", "#ffb36b"],
      blobs: [["#ffd86b", 0.1, 0.1, 0.6], ["#ff2e93", 0.95, 0.25, 0.6], ["#ff9a5a", 0.6, 1.0, 0.65], ["#b84dff", 0.0, 0.9, 0.45]],
    },
    { // Graphite: soft dark neutral
      base: ["#1c1d22", "#2f3138", "#16171b"],
      blobs: [["#5a6275", 0.2, 0.15, 0.6], ["#3d4250", 0.9, 0.9, 0.6], ["#6b5f7a", 0.85, 0.1, 0.45]],
    },
    // Photo wallpapers from the extension folder (drawn "cover"-style, centered).
    // `base` is the fallback gradient if the image can't be loaded.
    { image: "Bg-1.jpg", base: ["#ff3b5c", "#ff7a3d", "#1a8fe0"], blobs: [] },
    { image: "Bg-2.jpg", base: ["#cfd8cc", "#8aa37a", "#c9874a"], blobs: [] },
  ];

  function drawImageCover(ctx, img, w, h) {
    const k = Math.max(w / img.width, h / img.height);
    const sw = w / k, sh = h / k;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
  }

  const DOTS = [["#ff5f57", "#e0443e"], ["#febc2e", "#dea123"], ["#28c840", "#1aab29"]];
  const MAX_SIDE = 30000;

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function drawWallpaper(ctx, w, h, wp) {
    const lg = ctx.createLinearGradient(0, 0, w, h);
    wp.base.forEach((c, i) => lg.addColorStop(i / (wp.base.length - 1), c));
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, w, h);
    const d = Math.max(w, h);
    for (const [c, x, y, r] of wp.blobs) {
      const rg = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * d);
      rg.addColorStop(0, rgba(c, 0.85));
      rg.addColorStop(0.45, rgba(c, 0.35));
      rg.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // Is the top of the screenshot dark? Then use a dark title bar to match.
  function isDarkTop(bitmap) {
    try {
      const c = new OffscreenCanvas(16, 4);
      const x = c.getContext("2d");
      x.drawImage(bitmap, 0, 0, bitmap.width, Math.max(1, Math.min(bitmap.height, 24)), 0, 0, 16, 4);
      const d = x.getImageData(0, 0, 16, 4).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return sum / (d.length / 4) < 110;
    } catch { return false; }
  }

  /**
   * bitmap: the plain screenshot (ImageBitmap or canvas)
   * style:  { wallpaper: index }
   * u:      device pixels per CSS pixel (keeps chrome crisp on HiDPI)
   * wpImage: decoded image for photo wallpapers (ImageBitmap), if any
   * returns an OffscreenCanvas
   */
  function render(bitmap, style, u, wpImage) {
    u = Math.max(1, u || 1);
    const W = bitmap.width, H = bitmap.height;
    const bar = Math.round(30 * u);
    const radius = Math.round(10 * u);
    const pad = Math.round(Math.min(Math.max(Math.max(W, H + bar) * 0.08, 48 * u), 140 * u));
    const cw = W + pad * 2, ch = H + bar + pad * 2;
    if (cw > MAX_SIDE || ch > MAX_SIDE) return null; // too large to frame

    const wp = WALLPAPERS[(style?.wallpaper ?? 0) % WALLPAPERS.length];
    const dark = isDarkTop(bitmap);
    const c = new OffscreenCanvas(cw, ch);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";

    if (wp.image && wpImage) drawImageCover(ctx, wpImage, cw, ch);
    else drawWallpaper(ctx, cw, ch, wp);

    const x = pad, y = pad, ww = W, wh = H + bar;

    // window shadow (two layers: wide soft + tight contact)
    ctx.save();
    ctx.fillStyle = dark ? "#2b2b2f" : "#ececee";
    ctx.shadowColor = "rgba(0,0,0,0.38)";
    ctx.shadowBlur = 60 * u;
    ctx.shadowOffsetY = 24 * u;
    ctx.beginPath(); ctx.roundRect(x, y, ww, wh, radius); ctx.fill();
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 6 * u;
    ctx.shadowOffsetY = 2 * u;
    ctx.fill();
    ctx.restore();

    // window contents, clipped to rounded corners
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, ww, wh, radius); ctx.clip();
    const tg = ctx.createLinearGradient(0, y, 0, y + bar);
    if (dark) { tg.addColorStop(0, "#38383c"); tg.addColorStop(1, "#2c2c30"); }
    else { tg.addColorStop(0, "#f4f4f6"); tg.addColorStop(1, "#e6e6e9"); }
    ctx.fillStyle = tg;
    ctx.fillRect(x, y, ww, bar);
    ctx.drawImage(bitmap, x, y + bar);
    // title bar bottom hairline
    ctx.fillStyle = dark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.12)";
    ctx.fillRect(x, y + bar - Math.max(1, Math.round(u)), ww, Math.max(1, Math.round(u)));
    ctx.restore();

    // window outline
    ctx.save();
    ctx.lineWidth = Math.max(1, u);
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.18)";
    ctx.beginPath(); ctx.roundRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, ww - ctx.lineWidth, wh - ctx.lineWidth, radius); ctx.stroke();
    ctx.restore();

    // traffic lights
    const r = 6 * u, cy = y + bar / 2;
    DOTS.forEach(([fill, edge], i) => {
      const cx = x + 14 * u + r + i * 20 * u;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = Math.max(0.5, 0.6 * u); ctx.strokeStyle = edge; ctx.stroke();
    });

    // where the screenshot sits inside the mockup (used by the editor overlay)
    c.contentX = x;
    c.contentY = y + bar;
    return c;
  }

  g.SnapMockup = { render, WALLPAPERS };
})(typeof self !== "undefined" ? self : window);
