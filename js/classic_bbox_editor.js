import { app } from "../../scripts/app.js";

// Classic (litegraph canvas) mode editor for Create Bounding Boxes nodes.
//
// The core `boundingboxes` widget only has a Vue implementation: in classic
// rendering its litegraph stub just draws a "Vue only" warning. This file
// gives BOTH the core node and the Auto-Rescale clone a full in-node editor
// in classic mode, mirroring the Nodes 2.0 widget:
//
//   - the editor_state widget row is hidden (it stays as the data holder),
//   - a DOM widget (same machinery classic uses for image previews) is
//     mounted over that row: live canvas with boxes/tags/grid + a sidebar
//     for type/text/desc/palette, exactly like the Vue node's editor,
//   - interaction is identical to the Vue editor: drag on empty space to
//     create, drag to move, 8 handles to resize, Del to delete,
//     double-click for inline description editing, grid snap.
//
// At low zoom the DOM layer hides the editor; the widget's canvas draw then
// renders a static preview instead.
//
// Data format is identical to the Vue editor (pixel-space boxes + metadata
// in the width/height widget space), so workflows, the backend, and Nodes
// 2.0 mode all keep working unchanged.
//
// Only active when classic rendering is on (Comfy.VueNodes.Enabled !== true).

const EDIT_CLASSES = new Set([
  "CreateBoundingBoxesAutoRescale",
]);
const LOG = "[BBox-ClassicEditor]";

const HANDLE_PX = 8;
const BG_DIM = 0.75;
const MAX_ELEMENT_COLORS = 5;
const GRID_PX = 32;
const MAX_GRID_CELLS = 64;
const DOT_ALPHA = 0.18;
const DOT_RADIUS = 1;
const SIDEBAR_W = 230;
const TOOLBAR_H = 30;
// Keep tiny: fitNode sizes the node to its content exactly. A large
// minHeight here would force the DOM container taller than the node's
// allocated area (visible as a background strip below the frame for
// landscape images), and corrupt the chrome measurement.
const EDITOR_MIN_H = 100;

function safe(label, fn) {
  try {
    return fn();
  } catch (e) {
    console.warn(LOG, label, "failed:", (e && e.stack) || e);
    return undefined;
  }
}

function isClassicMode() {
  try {
    return app.ui?.settings?.getSettingValue("Comfy.VueNodes.Enabled") !== true;
  } catch {
    return false;
  }
}

function getWidget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

function dimValue(node, name) {
  const v = getWidget(node, name)?.value;
  return typeof v === "number" && v > 0 ? v : 1024;
}

// ---------------------------------------------------------------------------
// Region math — ported from the core frontend's boundingBoxesUtil.ts so the
// classic editor behaves exactly like the Vue one.
// ---------------------------------------------------------------------------

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function normalizeBox(b) {
  let { x, y, w, h } = b;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  x = clamp01(x);
  y = clamp01(y);
  w = Math.min(w, 1 - x);
  h = Math.min(h, 1 - y);
  return { ...b, x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

function rectHitTest(mx, my, x1, y1, x2, y2, rx, ry) {
  const h = (cx, cy) => Math.abs(mx - cx) < rx && Math.abs(my - cy) < ry;
  if (h(x1, y1)) return "resize-tl";
  if (h(x2, y1)) return "resize-tr";
  if (h(x1, y2)) return "resize-bl";
  if (h(x2, y2)) return "resize-br";
  if (mx >= x1 && mx <= x2 && Math.abs(my - y1) < ry) return "resize-t";
  if (mx >= x1 && mx <= x2 && Math.abs(my - y2) < ry) return "resize-b";
  if (my >= y1 && my <= y2 && Math.abs(mx - x1) < rx) return "resize-l";
  if (my >= y1 && my <= y2 && Math.abs(mx - x2) < rx) return "resize-r";
  if (mx >= x1 && mx <= x2 && my >= y1 && my <= y2) return "move";
  return null;
}

function applyDrag(mode, start, dx, dy) {
  let { x, y, w, h } = start;
  switch (mode) {
    case "move":
      x += dx; y += dy;
      x = clamp01(Math.min(x, 1 - w));
      y = clamp01(Math.min(y, 1 - h));
      break;
    case "draw":
    case "resize-br": w += dx; h += dy; break;
    case "resize-tl": x += dx; y += dy; w -= dx; h -= dy; break;
    case "resize-tr": y += dy; w += dx; h -= dy; break;
    case "resize-bl": x += dx; w -= dx; h += dy; break;
    case "resize-t": y += dy; h -= dy; break;
    case "resize-b": h += dy; break;
    case "resize-l": x += dx; w -= dx; break;
    case "resize-r": w += dx; break;
  }
  return mode === "move"
    ? { ...start, x, y }
    : normalizeBox({ ...start, x, y, w, h });
}

function boxesAt(regions, mxN, myN, handlePx, logW, logH, activeIdx) {
  const rx = handlePx / Math.max(1, logW);
  const ry = handlePx / Math.max(1, logH);
  const res = [];
  for (let i = 0; i < regions.length; i++) {
    const b = regions[i];
    const mode = rectHitTest(mxN, myN, b.x, b.y, b.x + b.w, b.y + b.h, rx, ry);
    if (mode) res.push({ index: i, mode });
  }
  const ai = res.findIndex((c) => c.index === activeIdx);
  if (ai > 0) res.unshift(res.splice(ai, 1)[0]);
  return res;
}

function tagRects(regions, logW, logH, measureWidth, height = 14) {
  const placed = [];
  const rects = [];
  const hits = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (let i = 0; i < regions.length; i++) {
    const b = regions[i];
    const x1 = b.x * logW, y1 = b.y * logH;
    const x2 = (b.x + b.w) * logW, y2 = (b.y + b.h) * logH;
    const tag = String(i + 1).padStart(2, "0");
    const w = measureWidth(tag) + 8;
    let pick = [x1, y1];
    for (const [cx, cy] of [[x1, y1], [x2 - w, y1], [x2 - w, y2 - height], [x1, y2 - height]]) {
      const candidate = { x: cx, y: cy, w, h: height, tag };
      if (!placed.some((p) => hits(candidate, p))) { pick = [cx, cy]; break; }
    }
    const r = { x: pick[0], y: pick[1], w, h: height, tag };
    placed.push(r);
    rects[i] = r;
  }
  return rects;
}

function isBoundingBox(b) {
  return !!b && typeof b === "object" &&
    typeof b.x === "number" && typeof b.y === "number" &&
    typeof b.width === "number" && typeof b.height === "number";
}

function normalizeHexColor(color) {
  if (typeof color !== "string") return null;
  const hex = color.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(hex) ? hex : null;
}

function normalizePalette(palette) {
  return Array.isArray(palette)
    ? palette.map(normalizeHexColor).filter((c) => c !== null)
    : [];
}

function fromBoundingBoxes(boxes, width, height) {
  const w = width || 1, h = height || 1;
  return (boxes || []).filter(isBoundingBox).map((box) => {
    const meta = box.metadata && typeof box.metadata === "object" ? box.metadata : {};
    return {
      x: box.x / w, y: box.y / h,
      w: box.width / w, h: box.height / h,
      type: meta.type === "text" ? "text" : "obj",
      text: typeof meta.text === "string" ? meta.text : "",
      desc: typeof meta.desc === "string" ? meta.desc : "",
      palette: normalizePalette(meta.palette),
    };
  });
}

function toBoundingBoxes(regions, width, height) {
  return regions.map((r) => ({
    x: Math.round(r.x * width),
    y: Math.round(r.y * height),
    width: Math.round(r.w * width),
    height: Math.round(r.h * height),
    metadata: {
      type: r.type,
      text: r.text,
      desc: r.desc,
      palette: r.palette.slice(),
    },
  }));
}

function readableTextColor(hex) {
  const m = /^#([0-9a-f]{6})/.exec(hex || "");
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#000000" : "#ffffff";
}

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxW) { out.push(line); line = word; }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

function gridSpec(widthValue, heightValue) {
  const axisFraction = (size) =>
    Math.max(GRID_PX, Math.ceil(size / MAX_GRID_CELLS)) / size;
  return { fx: axisFraction(widthValue), fy: axisFraction(heightValue) };
}

function snapFraction(value, step) {
  return step > 0 ? clamp01(Math.round(value / step) * step) : value;
}

function snapRegion(region, mode, grid, widthValue, heightValue) {
  if (!grid) return region;
  const { fx, fy } = gridSpec(widthValue, heightValue);
  if (mode === "move") {
    return {
      ...region,
      x: Math.min(snapFraction(region.x, fx), 1 - region.w),
      y: Math.min(snapFraction(region.y, fy), 1 - region.h),
    };
  }
  const snapLeft = mode === "draw" || mode === "resize-l" || mode === "resize-tl" || mode === "resize-bl";
  const snapRight = mode === "draw" || mode === "resize-r" || mode === "resize-tr" || mode === "resize-br";
  const snapTop = mode === "draw" || mode === "resize-t" || mode === "resize-tl" || mode === "resize-tr";
  const snapBottom = mode === "draw" || mode === "resize-b" || mode === "resize-bl" || mode === "resize-br";
  const x1 = snapLeft ? snapFraction(region.x, fx) : region.x;
  const y1 = snapTop ? snapFraction(region.y, fy) : region.y;
  const x2 = snapRight ? snapFraction(region.x + region.w, fx) : region.x + region.w;
  const y2 = snapBottom ? snapFraction(region.y + region.h, fy) : region.y + region.h;
  return { ...region, x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

// Letterbox fit (contain) of an image with aspect W/H inside a box of
// aspect boxW/boxH, in fraction space.
function fitFractions(W, H, boxW, boxH) {
  const imgA = W / H, boxA = boxW / boxH;
  if (boxA > imgA) {
    const sw = imgA / boxA;
    return { ox: (1 - sw) / 2, oy: 0, sw, sh: 1 };
  }
  const sh = boxA / imgA;
  return { ox: 0, oy: (1 - sh) / 2, sw: 1, sh };
}

// Shared box painter. Draws into a letterboxed viewport inside (boxW, boxH);
// applies the fit transform itself.
function drawRegions(ctx, regions, boxW, boxH, W, H, opts) {
  const { activeIndex = -1, grid, emptyHint = false } = opts;
  const fit = fitFractions(W, H, boxW, boxH);
  const vw = fit.sw * boxW, vh = fit.sh * boxH;

  ctx.save();
  ctx.translate(fit.ox * boxW, fit.oy * boxH);

  if (grid) {
    const { fx, fy } = gridSpec(W, H);
    if (fx > 0 && fy > 0) {
      const cols = Math.round(1 / fx), rows = Math.round(1 / fy);
      ctx.save();
      ctx.globalAlpha = DOT_ALPHA;
      ctx.fillStyle = "#c8c8c8";
      ctx.beginPath();
      for (let i = 0; i <= cols; i++) {
        const cx = Math.min(1, i * fx) * vw;
        for (let j = 0; j <= rows; j++) {
          const cy = Math.min(1, j * fy) * vh;
          ctx.moveTo(cx + DOT_RADIUS, cy);
          ctx.arc(cx, cy, DOT_RADIUS, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.font = "bold 11px monospace";
  const tagRectsArr = tagRects(regions, vw, vh, (s) => ctx.measureText(s).width);

  for (let i = 0; i < regions.length; i++) {
    const b = regions[i];
    const active = i === activeIndex;
    const pal = b.palette.filter(Boolean);
    const col = pal.length ? pal[0] : "#8c8c8c";
    const x1 = b.x * vw, y1 = b.y * vh;
    const x2 = (b.x + b.w) * vw, y2 = (b.y + b.h) * vh;
    const w = x2 - x1, h = y2 - y1;

    if (active) {
      ctx.fillStyle = "rgba(26,26,26,0.88)";
      ctx.fillRect(x1, y1, w, h);
    }
    ctx.fillStyle = col + (active ? "3a" : "22");
    ctx.fillRect(x1, y1, w, h);

    const lw = active ? 2 : 1;
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.strokeRect(x1 + lw / 2, y1 + lw / 2, w - lw, h - lw);

    if (pal.length) {
      const sw = w / pal.length, sh = 7;
      for (let p = 0; p < pal.length; p++) {
        const sx = x1 + Math.round(p * sw);
        ctx.fillStyle = pal[p];
        ctx.fillRect(sx, y1, x1 + Math.round((p + 1) * sw) - sx, sh);
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x1, y1, w, h);
    ctx.clip();
    let body = b.desc || "";
    if (b.type === "text" && b.text) body = `"${b.text}"` + (body ? ` — ${body}` : "");
    if (body) {
      ctx.font = "12px monospace";
      ctx.fillStyle = readableTextColor(col);
      const pad = 4, lh = 14;
      let ty = y1 + 15 + 12;
      for (const line of wrapLines(ctx, body, w - pad * 2)) {
        if (ty > y1 + h) break;
        ctx.fillText(line, x1 + pad, ty);
        ty += lh;
      }
    }
    const tr = tagRectsArr[i];
    ctx.font = "bold 11px monospace";
    ctx.fillStyle = col;
    ctx.fillRect(tr.x, tr.y, tr.w, 14);
    ctx.fillStyle = readableTextColor(col);
    ctx.fillText(tr.tag, tr.x + 4, tr.y + 11);
    ctx.restore();
  }

  if (emptyHint && !regions.length) {
    ctx.font = "13px sans-serif";
    ctx.fillStyle = "#8a8a8a";
    ctx.textAlign = "center";
    ctx.fillText("空の場所をドラッグしてボックスを作成", vw / 2, vh / 2);
    ctx.textAlign = "left";
  }

  ctx.restore();
  return fit;
}

// ---------------------------------------------------------------------------
// Shared per-node state: background image cache + incoming-box application,
// fed by the "executed" websocket event (the same ui payload the Vue editor
// reads from its output store).
// ---------------------------------------------------------------------------

function applyExecutedUi(node, output) {
  if (!output || typeof output !== "object") return;
  const bgImgs = output.background_images;
  if (Array.isArray(bgImgs) && bgImgs.length) {
    const img = bgImgs[0];
    const url = new URL(`${app.api.api_base}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${img.type || "output"}`);
    if (node.__bceBgUrl !== url.href) {
      node.__bceBgUrl = url.href;
      node.__bceBgImg = null;
      const probe = new Image();
      probe.onload = () => { node.__bceBgImg = probe; };
      probe.src = url.href;
    }
  } else if (node.__bceBgUrl) {
    node.__bceBgUrl = null;
    node.__bceBgImg = null;
  }

  const incoming = output.input_bboxes;
  if (Array.isArray(incoming) && incoming.length && incoming.every(isBoundingBox)) {
    const li = getWidget(node, "last_incoming");
    const applied = Array.isArray(li?.value) ? li.value : [];
    if (JSON.stringify(incoming) !== JSON.stringify(applied)) {
      const w = getWidget(node, "editor_state");
      if (w) w.value = structuredClone(incoming);
      if (li) li.value = structuredClone(incoming);
      node.__bceInvalidate?.();
      node.setDirtyCanvas(true, false);
    }
  }
}

// ---------------------------------------------------------------------------
// Styles for the embedded editor
// ---------------------------------------------------------------------------

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
.bce-root{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:#191919;border-radius:6px;color:#e5e5e5;font-family:system-ui,sans-serif;overflow:hidden}
.bce-bar{display:flex;align-items:center;gap:6px;padding:4px 8px;flex:0 0 ${TOOLBAR_H}px;border-bottom:1px solid #333;font-size:11px}
.bce-bar .bce-dims{color:#9a9a9a;margin-right:auto;white-space:nowrap;overflow:hidden}
.bce-btn{background:#2b2b2b;border:1px solid #444;color:#ddd;border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer;flex:0 0 auto}
.bce-btn:hover{background:#383838}
.bce-btn.on{background:#46530a;border-color:#6a7a1a}
.bce-btn.danger{color:#f87171}
.bce-toolbtn{flex:0 0 72px;text-align:center}
.bce-body{display:flex;flex-direction:column;gap:8px;padding:8px;flex:0 0 auto;min-height:0}
.bce-canvaswrap{position:relative;flex:0 0 auto;width:100%;background:transparent;border:0;overflow:hidden}
.bce-canvaswrap canvas{display:block;position:relative;outline:none;cursor:crosshair;border-radius:4px}
.bce-inline{position:absolute;box-sizing:border-box;background:rgba(0,0,0,.9);border:2px solid #46b4e6;border-radius:4px;color:#fff;font-family:monospace;font-size:12px;padding:4px;resize:none;outline:none;z-index:5}
.bce-side{flex:0 0 auto;width:100%;display:flex;flex-direction:column;gap:6px}
.bce-side .bce-empty{color:#888;font-size:11px;width:100%}
.bce-seg{display:flex;width:100%;border:1px solid #444;border-radius:6px;overflow:hidden}
.bce-seg button{flex:1;background:#222;border:0;color:#999;padding:5px;font-size:11px;cursor:pointer}
.bce-seg button.on{background:#3d3d3d;color:#eee}
.bce-field{display:flex;flex-direction:column;gap:2px;width:100%}
.bce-field label{font-size:10px;color:#999}
.bce-field textarea,.bce-field input[type=text]{background:#222;border:1px solid #444;border-radius:6px;color:#eee;font-size:11px;padding:5px;min-height:36px;resize:vertical;font-family:inherit}
.bce-pal{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.bce-pal input[type=color]{width:30px;height:24px;border:1px solid #444;border-radius:4px;background:#222;padding:1px;cursor:pointer}
.bce-btn.danger{width:100%}
.bce-hint{color:#777;font-size:10px;line-height:1.5;width:100%}
`;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------------------
// Embedded in-node editor
// ---------------------------------------------------------------------------

function createEditorUI(node, root) {
  injectStyles();

  const stateWidget = getWidget(node, "editor_state");
  if (!stateWidget) return { destroy() {} };

  let W = dimValue(node, "width");
  let H = dimValue(node, "height");
  let regions = fromBoundingBoxes(stateWidget.value, W, H);
  let activeIndex = -1;
  let grid = node.properties?.bboxGrid !== false;
  let drawing = false;
  let dragMode = null;
  let dragStart = null;
  let boxAtStart = null;
  let prevActiveIndex = -1; // selection before a pending new-box drag started
  let inlineEditor = null; // {index, el}
  let raf = 0;
  let lastFit = { ox: 0, oy: 0, sw: 1, sh: 1 };

  // ---- toolbar -------------------------------------------------------------
  const bar = document.createElement("div");
  bar.className = "bce-bar";
  root.appendChild(bar);
  const dimsLabel = document.createElement("span");
  dimsLabel.className = "bce-dims";
  bar.appendChild(dimsLabel);
  const gridBtn = document.createElement("button");
  gridBtn.className = "bce-btn bce-toolbtn";
  gridBtn.textContent = "Grid";
  const clearBtn = document.createElement("button");
  clearBtn.className = "bce-btn bce-toolbtn danger";
  clearBtn.textContent = "Clear";
  bar.appendChild(gridBtn);
  bar.appendChild(clearBtn);

  function syncDimsLabel() {
    dimsLabel.textContent = `${W}×${H} / ${regions.length} boxes`;
  }
  function syncGridBtn() {
    gridBtn.classList.toggle("on", grid);
  }
  gridBtn.addEventListener("click", () => {
    grid = !grid;
    node.properties = node.properties || {};
    node.properties.bboxGrid = grid;
    syncGridBtn();
    requestDraw();
  });
  clearBtn.addEventListener("click", () => {
    regions = [];
    activeIndex = -1;
    const li = getWidget(node, "last_incoming");
    if (li) li.value = [];
    commit();
    buildSidebar();
    requestDraw();
  });
  syncGridBtn();

  // ---- body: canvas + sidebar ----------------------------------------------
  const body = document.createElement("div");
  body.className = "bce-body";
  root.appendChild(body);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "bce-canvaswrap";
  body.appendChild(canvasWrap);
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  canvasWrap.appendChild(canvas);

  const side = document.createElement("div");
  side.className = "bce-side";
  body.appendChild(side);

  const hint = document.createElement("div");
  hint.className = "bce-hint";
  hint.textContent =
    "ドラッグ:新規 / 内側:移動 / ハンドル:リサイズ / ダブルクリック:説明編集 / Del:削除 / Alt+クリック:隠れた箱を選択";
  side.appendChild(hint);

  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
    return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
  }

  // ---- sidebar (same stacked order as the Vue node: tabs → text → desc →
  // palette; usage hint goes last) --------------------------------------------
  function buildSidebar() {
    side.textContent = "";
    const b = activeIndex >= 0 ? regions[activeIndex] : null;
    if (!b) {
      const p = document.createElement("div");
      p.className = "bce-empty";
      p.textContent = "箱を選ぶとここで型・テキスト・説明・色を編集できます。";
      side.appendChild(p);
      side.appendChild(hint);
      fitNode();
      return;
    }
    const idx = activeIndex;

    const seg = document.createElement("div");
    seg.className = "bce-seg";
    const objBtn = document.createElement("button");
    objBtn.textContent = "要素 (obj)";
    objBtn.classList.toggle("on", b.type !== "text");
    const txtBtn = document.createElement("button");
    txtBtn.textContent = "テキスト (text)";
    txtBtn.classList.toggle("on", b.type === "text");
    objBtn.addEventListener("click", () => { b.type = "obj"; commit(); buildSidebar(); });
    txtBtn.addEventListener("click", () => { b.type = "text"; commit(); buildSidebar(); });
    seg.appendChild(objBtn);
    seg.appendChild(txtBtn);
    side.appendChild(seg);

    if (b.type === "text") {
      const f = document.createElement("div");
      f.className = "bce-field";
      const l = document.createElement("label");
      l.textContent = "テキスト";
      const ta = document.createElement("textarea");
      ta.value = b.text || "";
      ta.addEventListener("input", () => { b.text = ta.value; commit(); });
      f.appendChild(l); f.appendChild(ta);
      side.appendChild(f);
    }

    const f2 = document.createElement("div");
    f2.className = "bce-field";
    const l2 = document.createElement("label");
    l2.textContent = "説明 (desc)";
    const ta2 = document.createElement("textarea");
    ta2.value = b.desc || "";
    ta2.addEventListener("input", () => { b.desc = ta2.value; commit(); });
    f2.appendChild(l2); f2.appendChild(ta2);
    side.appendChild(f2);

    const f3 = document.createElement("div");
    f3.className = "bce-field";
    const l3 = document.createElement("label");
    l3.textContent = `カラーパレット (最大${MAX_ELEMENT_COLORS})`;
    const pal = document.createElement("div");
    pal.className = "bce-pal";
    for (let p = 0; p < b.palette.length; p++) {
      const inp = document.createElement("input");
      inp.type = "color";
      inp.value = b.palette[p].slice(0, 7);
      inp.addEventListener("input", () => { b.palette[p] = inp.value; commit(); requestDraw(); });
      pal.appendChild(inp);
    }
    if (b.palette.length < MAX_ELEMENT_COLORS) {
      const add = document.createElement("button");
      add.className = "bce-btn";
      add.textContent = "+";
      add.addEventListener("click", () => {
        const hue = (b.palette.length * 67 + idx * 31) % 360;
        b.palette.push(hslHex(hue, 62, 55));
        commit(); buildSidebar(); requestDraw();
      });
      pal.appendChild(add);
    }
    if (b.palette.length) {
      const del = document.createElement("button");
      del.className = "bce-btn";
      del.textContent = "−";
      del.addEventListener("click", () => {
        b.palette.pop();
        commit(); buildSidebar(); requestDraw();
      });
      pal.appendChild(del);
    }
    f3.appendChild(l3); f3.appendChild(pal);
    side.appendChild(f3);

    const info = document.createElement("div");
    info.className = "bce-empty";
    info.textContent = `box ${idx + 1}: x=${Math.round(b.x * W)} y=${Math.round(b.y * H)} w=${Math.round(b.w * W)} h=${Math.round(b.h * H)}`;
    side.appendChild(info);

    const delBtn = document.createElement("button");
    delBtn.className = "bce-btn danger";
    delBtn.textContent = "この箱を削除";
    delBtn.addEventListener("click", () => { removeRegion(idx); commit(); buildSidebar(); requestDraw(); });
    side.appendChild(delBtn);
    side.appendChild(hint);
    // sidebar content height just changed (tab switch, palette +/-, box
    // select): re-fit so the bottom controls are never cut off
    fitNode();
  }

  // ---- canvas drawing ------------------------------------------------------
  // The canvas element is sized to EXACTLY the image rectangle (aspect-locked
  // inside the wrap), so there is no dead letterbox area around the grid.
  function logicalSize() {
    return { w: canvas.clientWidth || 1, h: canvas.clientHeight || 1 };
  }

  function requestDraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; drawCanvas(); });
  }

  // Target CSS width of the canvas in LAYOUT px. The .dom-widget element is
  // transform-scaled by ds.scale, so style/offset values are in node units:
  // dom-widget layout width = node.size[0] - 20, wrap = that - 16 padding.
  function targetCanvasW() {
    return Math.max(1, node.size[0] - 36);
  }

  function drawCanvas() {
    // canvas spans the FULL node width; its height follows the image aspect
    const Wl = targetCanvasW();
    const Hl = Math.max(1, Math.round((Wl * H) / W));
    if (canvas.style.width !== `${Wl}px`) canvas.style.width = `${Wl}px`;
    if (canvas.style.height !== `${Hl}px`) canvas.style.height = `${Hl}px`;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(Wl * dpr);
    const bh = Math.round(Hl * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw; canvas.height = bh;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, Wl, Hl);
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, Wl, Hl);

    // canvas IS the image rect now
    lastFit = { ox: 0, oy: 0, sw: 1, sh: 1 };
    const bg = node.__bceBgImg;
    if (bg) {
      ctx.drawImage(bg, 0, 0, Wl, Hl);
      ctx.fillStyle = `rgba(0,0,0,${BG_DIM})`;
      ctx.fillRect(0, 0, Wl, Hl);
    }
    drawRegions(ctx, regions, Wl, Hl, W, H, { activeIndex, grid, emptyHint: true });
    syncDimsLabel();
    if (inlineEditor) positionInlineEditor();
    fitNode();
  }

  // Keep the node body exactly as tall as its content (toolbar + canvas +
  // controls), like the Vue node: no dead space around the canvas.
  let chromeUnits = null; // node-unit chrome above the DOM area (title+widgets)
  let resizingUntil = 0;  // while > now, onResize owns the height (no fitNode)
  let settleTimer = 0;
  function fitNode() {
    if (performance.now() < resizingUntil) return;
    const natural = bar.offsetHeight + canvas.offsetHeight + side.offsetHeight + 24;
    // chrome = title bar + widget rows: derive from the DOM widget container,
    // whose height is always tied to the node's allocated size.
    const cont = root.parentElement;
    if (!cont || !cont.offsetHeight) return;
    chromeUnits = Math.max(0, node.size[1] - cont.offsetHeight);
    const wantH = Math.max(320, chromeUnits + natural);
    if (Math.abs(node.size[1] - wantH) > 2) {
      node.size[1] = wantH;
      node.setDirtyCanvas(true, true);
    }
  }

  // During a resize gesture the height is DERIVED from the width (content
  // fit), not clamped: one deterministic writer, so the bottom never
  // bounces between "too small" and "clamped back" frames.
  const prevOnResize = node.onResize;
  node.onResize = function (size) {
    if (prevOnResize) prevOnResize.call(this, size);
    safe("onResize-fit", () => {
      if (chromeUnits == null) return;
      resizingUntil = performance.now() + 400;
      const canvasW = targetCanvasW();
      const canvasH = Math.round((canvasW * H) / W);
      // measure the sidebar's REAL wrapped height at the NEW width
      // (narrower nodes wrap text taller) before deciding the height,
      // so the bottom controls are never hidden mid-drag
      const prevSideW = side.style.width;
      side.style.width = `${canvasW}px`;
      const sideH = side.offsetHeight;
      side.style.width = prevSideW;
      const requiredRoot = bar.offsetHeight + canvasH + sideH + 24;
      const wantH = Math.ceil(chromeUnits + requiredRoot);
      if (Math.abs(node.size[1] - wantH) > 1) {
        node.size[1] = wantH;
        node.setDirtyCanvas(true, true);
      }
      requestDraw();
      // one authoritative settle after the gesture: the DOM (sidebar text
      // re-wrapping at the new width) is now exact, so fitNode corrects
      // any estimate error in a single smooth step — no flicker loop.
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        resizingUntil = 0;
        fitNode();
      }, 250);
    });
  };

  const ro = new ResizeObserver(() => requestDraw());
  ro.observe(root);

  // ---- commit back to the widget -------------------------------------------
  function commit() {
    stateWidget.value = toBoundingBoxes(regions, W, H);
    node.setDirtyCanvas(true, true);
    app.graph.setDirtyCanvas(true, false);
    syncDimsLabel();
  }

  function reloadFromWidget() {
    regions = fromBoundingBoxes(stateWidget.value, W, H);
    if (activeIndex >= regions.length) activeIndex = regions.length ? 0 : -1;
    buildSidebar();
    requestDraw();
  }
  node.__bceInvalidate = () => {
    // external change (executed event / Reload node): refresh live UI
    safe("reloadFromWidget", () => { checkDimsChanged(); reloadFromWidget(); });
  };

  function checkDimsChanged() {
    const nW = dimValue(node, "width");
    const nH = dimValue(node, "height");
    if (nW === W && nH === H) return;
    // Keep the normalized layout, re-express it in the new pixel space
    // (same as the Vue editor's width/height watcher).
    W = nW; H = nH;
    commit();
    requestDraw();
  }
  const dimTimer = setInterval(() => safe("dimCheck", checkDimsChanged), 500);

  // ---- pointer interaction --------------------------------------------------
  // pointer -> normalized coords inside the letterboxed viewport
  function pointerNorm(e) {
    const r = canvas.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    return {
      x: clamp01((fx - lastFit.ox) / lastFit.sw),
      y: clamp01((fy - lastFit.oy) / lastFit.sh),
    };
  }

  function titleAt(mN) {
    const { w: Wl, h: Hl } = logicalSize();
    const vw = lastFit.sw * Wl, vh = lastFit.sh * Hl;
    const ctx = canvas.getContext("2d");
    const rects = tagRects(regions, vw, vh, (s) => ctx.measureText(s).width);
    const px = mN.x * vw, py = mN.y * vh;
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
    }
    return null;
  }

  function pickForSelection(mN, cycle) {
    const { w: Wl, h: Hl } = logicalSize();
    const vw = lastFit.sw * Wl, vh = lastFit.sh * Hl;
    const cands = boxesAt(regions, mN.x, mN.y, HANDLE_PX, vw, vh, activeIndex);
    if (!cands.length) return null;
    const activeResize = cands.find((c) => c.index === activeIndex && c.mode !== "move");
    if (activeResize && !cycle) return activeResize;
    const ti = titleAt(mN);
    if (ti !== null && !cycle) return { index: ti, mode: "move" };
    if (cycle && cands.length > 1) {
      const pos = cands.findIndex((c) => c.index === activeIndex);
      return cands[(pos + 1) % cands.length];
    }
    return cands.find((c) => c.index === activeIndex && c.mode !== "move") || cands[0];
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    commitInlineEditor();
    canvas.focus();
    checkDimsChanged();
    const mN = pointerNorm(e);
    const hit = pickForSelection(mN, e.altKey);
    if (hit) {
      activeIndex = hit.index;
      dragMode = hit.mode;
      boxAtStart = { ...regions[hit.index] };
    } else {
      dragMode = "draw";
      prevActiveIndex = activeIndex;
      const nb = { x: mN.x, y: mN.y, w: 0, h: 0, type: "obj", text: "", desc: "", palette: [] };
      regions.push(nb);
      activeIndex = regions.length - 1;
      boxAtStart = { ...nb };
    }
    drawing = true;
    dragStart = mN;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    e.preventDefault();
    // Only rebuild the sidebar when an existing box was selected. For a
    // pending new box, rebuilding here makes the sidebar flicker on a
    // plain click (editor appears, then reverts on pointerup). The
    // pointerup handler rebuilds once the box is committed or discarded.
    if (hit) buildSidebar();
    requestDraw();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!drawing || !boxAtStart || !dragStart || !dragMode) return;
    const mN = pointerNorm(e);
    const dx = mN.x - dragStart.x;
    const dy = mN.y - dragStart.y;
    const nb = applyDrag(dragMode, boxAtStart, dx, dy);
    regions[activeIndex] = snapRegion(nb, dragMode, grid, W, H);
    requestDraw();
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!drawing) return;
    drawing = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    const b = regions[activeIndex];
    if (b && (b.w < 0.005 || b.h < 0.005)) {
      removeRegion(activeIndex);
      if (dragMode === "draw") activeIndex = prevActiveIndex;
    }
    commit();
    buildSidebar();
    requestDraw();
  });

  function removeRegion(i) {
    regions.splice(i, 1);
    if (!regions.length) activeIndex = -1;
    else if (i <= activeIndex) activeIndex = Math.max(0, activeIndex - 1);
  }

  // inline description editor (double-click)
  canvas.addEventListener("dblclick", (e) => {
    e.preventDefault();
    const mN = pointerNorm(e);
    const { w: Wl, h: Hl } = logicalSize();
    const vw = lastFit.sw * Wl, vh = lastFit.sh * Hl;
    const cands = boxesAt(regions, mN.x, mN.y, HANDLE_PX, vw, vh, activeIndex);
    if (!cands.length) return;
    const target = cands.find((c) => c.index === activeIndex) || cands[0];
    openInlineEditor(target.index);
  });

  function openInlineEditor(index) {
    const b = regions[index];
    activeIndex = index;
    const ta = document.createElement("textarea");
    ta.className = "bce-inline";
    ta.value = b.desc || "";
    inlineEditor = { index, el: ta };
    canvasWrap.appendChild(ta);
    positionInlineEditor();
    ta.addEventListener("input", () => { /* committed on blur/ctrl+enter */ });
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { destroyInlineEditor(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { commitInlineEditor(); }
    });
    ta.addEventListener("blur", () => commitInlineEditor());
    ta.focus();
    ta.select();
    buildSidebar();
    requestDraw();
  }

  function positionInlineEditor() {
    if (!inlineEditor) return;
    const b = regions[inlineEditor.index];
    if (!b) { destroyInlineEditor(); return; }
    const { w: Wl, h: Hl } = logicalSize();
    const vw = lastFit.sw * Wl, vh = lastFit.sh * Hl;
    const w = Math.min(vw, Math.max(70, b.w * vw));
    const h = Math.min(vh, Math.max(42, b.h * vh));
    // the canvas is centered inside the wrap; offset by its position there
    const offX = canvas.offsetLeft, offY = canvas.offsetTop;
    const left = offX + lastFit.ox * Wl + Math.max(0, Math.min(b.x * vw, vw - w));
    const top = offY + lastFit.oy * Hl + Math.max(0, Math.min(b.y * vh, vh - h));
    Object.assign(inlineEditor.el.style, {
      left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`,
      borderColor: b.palette.find(Boolean) || "#46b4e6",
    });
  }

  function commitInlineEditor() {
    const ed = inlineEditor;
    if (!ed) return;
    const b = regions[ed.index];
    if (b) b.desc = ed.el.value;
    destroyInlineEditor();
    commit();
    requestDraw();
  }

  function destroyInlineEditor() {
    if (inlineEditor?.el) inlineEditor.el.remove();
    inlineEditor = null;
  }

  // keyboard: delete selected box (only while the editor canvas has focus)
  canvas.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
    if ((e.key === "Delete" || e.key === "Backspace") && activeIndex >= 0 && !drawing) {
      e.preventDefault();
      e.stopPropagation();
      removeRegion(activeIndex);
      commit(); buildSidebar(); requestDraw();
    }
  });

  buildSidebar();
  requestDraw();

  return {
    destroy() {
      clearInterval(dimTimer);
      clearTimeout(settleTimer);
      ro.disconnect();
      destroyInlineEditor();
      node.onResize = prevOnResize;
      node.__bceInvalidate = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hookClassicEditor(node) {
  if (node.__bceHook) return;
  node.__bceHook = true;

  // The editor_state widget becomes a pure data holder: its canvas row is
  // hidden (value still serializes), and the DOM widget below takes over
  // that space with the live editor.
  const w = getWidget(node, "editor_state");
  if (!w) return;
  w.options = w.options || {};
  w.options.hidden = true;

  // Static preview fallback: drawn on the canvas when the DOM layer hides
  // the editor (zoomed out / low quality).
  w.draw = function (ctx, nd, width, y, Hraw) {
    safe("previewDraw", () => {
      const H = typeof w.computedHeight === "number" && w.computedHeight > 60
        ? w.computedHeight
        : Hraw;
      const W = dimValue(nd, "width");
      const Hh = dimValue(nd, "height");
      const regions = fromBoundingBoxes(w.value, W, Hh);
      const gridOn = nd.properties?.bboxGrid !== false;
      const pw = width - 20, ph = H - 4;

      ctx.save();
      roundRect(ctx, 10, y, pw, ph, 4);
      ctx.fillStyle = "#141414";
      ctx.fill();
      ctx.clip();
      ctx.translate(10, y);
      const fit = fitFractions(W, Hh, pw, ph);
      if (nd.__bceBgImg) {
        ctx.drawImage(nd.__bceBgImg, fit.ox * pw, fit.oy * ph, fit.sw * pw, fit.sh * ph);
        ctx.fillStyle = `rgba(0,0,0,${BG_DIM})`;
        ctx.fillRect(fit.ox * pw, fit.oy * ph, fit.sw * pw, fit.sh * ph);
      }
      drawRegions(ctx, regions, pw, ph, W, Hh, { activeIndex: -1, grid: gridOn });
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = "#3a3a3a";
      ctx.lineWidth = 1;
      roundRect(ctx, 10.5, y + 0.5, pw - 1, ph - 1, 4);
      ctx.stroke();
      ctx.restore();
    });
  };

  // The live editor: a DOM widget (same positioning machinery classic uses
  // for image previews) mounted over the node body.
  const el = document.createElement("div");
  el.className = "bce-root";
  const domWidget = node.addDOMWidget("bbox_editor", "custom", el, {
    serialize: false,
    hideOnZoom: true,
  });
  // The row must be growable so the editor fills the node body.
  domWidget.computeLayoutSize = () => ({
    minHeight: EDITOR_MIN_H,
    maxHeight: 100000,
    minWidth: 380,
    maxWidth: 100000,
  });

  const ui = createEditorUI(node, el);
  node.__bceDestroy = () => ui.destroy();

  // Give the editor a usable width; the node HEIGHT is auto-fitted to the
  // canvas aspect by fitNode() once the editor mounts.
  if (node.size[0] < 760) {
    node.size = [760, node.size[1]];
    node.setDirtyCanvas(true, true);
  }
}

app.registerExtension({
  name: "jam.bbox.classic-editor",
  nodeCreated(node) {
    if (!EDIT_CLASSES.has(node.comfyClass)) return;
    if (!isClassicMode()) return;
    // nodeCreated fires before configure(): defer so widget values from the
    // loaded workflow are already applied.
    setTimeout(() => safe("hookClassicEditor", () => hookClassicEditor(node)), 0);
  },
});

// Feed background-image cache + upstream re-initialization from run results
// (same ui payload the Vue editor consumes via its output store).
app.api.addEventListener("executed", (e) => {
  safe("executed-ui", () => {
    const detail = e?.detail;
    const output = detail?.output;
    if (!output) return;
    const nodeId = Number(detail.node ?? detail.node_id);
    if (!Number.isFinite(nodeId)) return;
    const node = app.graph?.getNodeById?.(nodeId);
    if (!node || !EDIT_CLASSES.has(node.comfyClass)) return;
    applyExecutedUi(node, output);
    node.__bceInvalidate?.();
    node.setDirtyCanvas(true, false);
  });
});
