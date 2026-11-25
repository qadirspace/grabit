# Grabit

A fast screenshot tool for Chrome. Click the toolbar icon, hover over any part of a web page and Grabit highlights the box under your cursor (a card, a row, a badge, an image). Click, and it's copied to your clipboard, framed as a Mac window. Your last 3 screenshots wait in the Library, where you can mark them up in a small editor.

Everything runs locally in your browser. The extension makes no network requests.

## Install (developer mode)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder (the one with `manifest.json`).
4. Optional: pin **Grabit** from the puzzle-piece menu so the icon stays in the toolbar.

After you edit any file, click the reload icon on the extension's card in `chrome://extensions`, then refresh the page you're testing on.

## Capture

| Action | How |
|---|---|
| Start / cancel | Click the toolbar icon, or press `Alt+Shift+S` |
| Capture an element | Hover to highlight it, then click |
| Capture an area | Click and drag a rectangle |
| Select the parent / child element | `↑` / `↓`, or `Alt` + scroll wheel |
| Capture the highlighted element | `Enter` |
| Cancel | `Esc` |

### What gets highlighted

The picker highlights the nearest thing under your cursor that looks like a box on screen. It notices:
- borders, including a single line under or beside an element;
- separate lines next to an element: an `<hr>`, a 1 px divider, or a vertical rule between columns;
- real shadows (`box-shadow` and `filter: drop-shadow`), ignoring the invisible ones many sites set on everything;
- outlines, and a background that differs from what's behind it;
- cards drawn by `::before` / `::after`;
- small details: inline badges and tags, icons from 12 px, code and keyboard snippets;
- list items, table cells, buttons, form fields and other built-in boxes.

Use `↑` / `↓` to step out to the surrounding box or into a smaller one.

Elements taller than the screen are scrolled through and stitched into one image. Fixed and sticky headers are hidden while this happens, and your scroll position is restored afterwards.

## Speed

There are no animations or visual effects, so nothing slows the tool down:
- The picker appears as soon as you press the shortcut. It doesn't take a screenshot of the page first.
- The highlight jumps straight to the element under your cursor.
- Panels are plain and solid, with no blur, grain or fade-in.
- A capture that fits on screen starts after the overlay disappears, without a fixed delay. The short wait (60 ms) is only used when the page has to scroll.

## Look

The colours come from the icon, a glassy lasso on a warm gradient tile (its source is `design/icon-studio.html`):

| Colour | Hex | Used for |
|---|---|---|
| Orange | `#FF9A4F` | start of the brand gradient |
| Coral | `#F2704F` | main accent: the picker outline, selected states, focus rings |
| Rose | `#EA86A6` | gradient middle |
| Sky | `#8FABD4` | end of the brand gradient |

Primary buttons and the picker's label use the orange-to-rose gradient. The editor and the quick-preview card have a thin brand-gradient edge. The Library, Settings and editor-window pages sit on a soft version of the icon's gradient, and follow your system's light or dark mode. All of it is static CSS, with no animation.

## After a capture

By default, clicking an element or finishing a drag copies the screenshot straight to your clipboard. No window opens. To confirm the copy, the captured area is outlined for a moment. If a site blocks the clipboard, a small card appears with a **Save** option instead.

## Names

Every screenshot is simply called **Screenshot** plus its size in CSS pixels, for example `Screenshot · 289 × 111`. The same name shows in the picker label, the Library, the right-click menu and the editor window's title. Saved files add the date and time.

## Recent screenshots

Right-click the toolbar icon to see your last 3 screenshots, listed by name and time:
- Click one to open it in the **editor window**.
- **Open Library** opens a page with all 3 as thumbnails. Each one has **Open**, **Copy** (copies it again with your current mockup settings) and **Delete**.
- **Settings** opens the Settings page.

Screenshots are kept in Chrome's local storage on this computer only. Only the last 3 are kept; older ones are deleted automatically.

## Editor

Open a screenshot from the right-click menu or the Library and it opens in its own window. If you set **After capture** to **Editor** in Settings, the editor also opens over the page right after each capture.

| Tool | Key | What it does |
|---|---|---|
| Pen | `P` | Freehand drawing |
| Highlighter | `H` | Thick, see-through marker |
| Arrow | `A` | Drag from start to tip |
| Box | `R` | Rounded rectangle outline |
| Blur | `B` | Pixelates an area, for hiding emails, names or numbers |

You can also choose from six colours and three sizes, and use **Undo** (`Ctrl+Z`), **Redo** (`Ctrl+Shift+Z`) and **Clear**.

The bottom bar has:
- **Plain / Mockup:** switches between the framed and the raw screenshot.
- **Wallpaper swatches:** change the mockup background.
- **⚙ (gear):** opens Settings.
- **Copy** (`Ctrl+C`): copies the edited image.
- **Save** (`Ctrl+S`): saves a PNG to `Downloads/Grabit/`, named like `Screenshot 289x111 2026-11-25 at 17.05.12.png`.
- **Done** (`Esc`): copies your changes if there are any, then closes.

Drawings always land on the screenshot itself, inside the window frame, never on the wallpaper.

## Settings

Open Settings from the gear in the editor, or right-click the toolbar icon and choose **Options**. You can change:
- **After capture:** **Copy only** (default; copy and briefly outline the area), **Editor** (open the drawing window right away) or **Preview** (a small card in the corner).
- **Copy to clipboard automatically:** on by default.
- **Mac window mockup:** on by default.
- **Default wallpaper:** `Bg-1.jpg` by default. The other options are four generated gradients (Dusk, Lagoon, Sunrise and Graphite) and `Bg-2.jpg`.
- **Keyboard shortcut:** shows the current shortcut and links to Chrome's shortcut page.

Changes made in the editor apply only to that screenshot. Defaults are set only on the Settings page.

### Adding a wallpaper

1. Put the image in this folder, next to `manifest.json`.
2. Add `{ image: "your-file.jpg", base: [...], blobs: [] }` to `WALLPAPERS` in `mockup.js`. The `base` colours are used if the image fails to load.
3. Add a matching colour-gradient swatch to `SWATCHES` in `content.js`, and an entry to `WALLS` in `options.js`.

## Files

- `manifest.json`: extension config (Manifest V3). Permissions: `activeTab`, `scripting`, `downloads`, `storage`, `unlimitedStorage` (so the 3 recent screenshots fit in local storage) and `contextMenus` (the right-click menu on the icon).
- `background.js`: starts a capture when you click the icon, builds the right-click menu, takes the tab screenshots, crops and stitches them, applies the mockup and your drawings, and saves files.
- `content.js`: the hover highlight, the drag selection, the scroll-and-stitch logic and the quick-preview card.
- `editor.js`: the editor and its drawing tools.
- `editor.html` / `editor-page.js`: the editor window for screenshots opened from the right-click menu or the Library.
- `library.html` / `library.js`: the Library page (recent screenshots).
- `mockup.js`: draws the Mac window frame and the wallpapers.
- `options.html` / `options.js`: the Settings page.
- `Bg-1.jpg`, `Bg-2.jpg`: photo wallpapers.
- `icons/`: toolbar icons and the cursor.
- `design/icon-studio.html`: the source of the icon. Open it in a browser to see or re-export it.
- `test/`: local test pages (`harness.html` for the picker and editor, `detect.html` for highlight detection and speed, `library-test.html`, `mockup-preview.html` for the wallpapers). They aren't used by the extension.

## Known limits

- Chrome blocks extensions on `chrome://` pages, the Chrome Web Store and the built-in PDF viewer. On those pages the icon shows a red `!`.
- If an element is wider than the window, only the visible width is captured.
- Very tall captures are capped at 20,000 CSS px.
- Some sites block clipboard access. When that happens, use **Save** instead.
- Tall captures take about half a second per screen, because Chrome allows at most 2 tab captures per second.
