import { app } from "../../scripts/app.js";

// Frontend companion for "Create Bounding Boxes (Auto-Rescale)".
//
// 1) Keeps the hidden draw_width / draw_height mirror widgets in sync with the
//    node's width/height WIDGET values (the space the canvas draws boxes in).
//    The server uses that mirror to proportionally rescale saved boxes when the
//    effective width/height come from a linked input (e.g. ResolutionSelector).
// 2) Hides internal widgets (last_incoming, draw_*). The core frontend only
//    hides last_incoming for the exact class "CreateBoundingBoxes", so a clone
//    node would otherwise render it as a second canvas.
// 3) Switches the canvas to the linked size the MOMENT the size changes:
//    ResolutionSelector (formula mirrored client-side on every
//    aspect_ratio/megapixels/multiple change) and Tier-1 widget-backed INT
//    sources (PrimitiveInt, SeedNode, CustomCombo, ColorToRGBInt — their
//    output IS their own widget) are pushed into the node's width/height
//    widgets live — but ONLY into inputs that are actually linked (each link
//    follows its own output slot; an unlinked input keeps its own widget
//    value). The core BoundingBoxes widget then rescales the drawn boxes and
//    the canvas aspect live.
// 4) Fallback for any other INT source: after a run, adopt the node's
//    executed ui dims as the canvas size.

const NODE_TYPE = "CreateBoundingBoxesAutoRescale";
const RS_TYPE = "ResolutionSelector";
const INTERNAL_WIDGETS = new Set(["last_incoming", "draw_width", "draw_height"]);
const LOG = "[BBox-AutoRescale]";

// Run one of our own side effects; never let it break the core's call chain.
// NOTE: when wrapping core callbacks we must use `function` + orig.call(this,
// ...) — arrow wrappers lose `this`, and the core int-widget callback
// (useIntWidget onValueChange) reads `this.options` and would crash the node
// with "Cannot read properties of undefined (reading 'options')".
function safe(label, fn) {
  try {
    return fn();
  } catch (e) {
    console.warn(LOG, label, "failed:", (e && e.stack) || e);
    return undefined;
  }
}

function getWidget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

function syncMirror(node) {
  const dw = getWidget(node, "draw_width");
  const dh = getWidget(node, "draw_height");
  if (!dw || !dh) return;
  const w = getWidget(node, "width")?.value;
  const h = getWidget(node, "height")?.value;
  if (typeof w === "number" && w > 0) dw.value = w;
  if (typeof h === "number" && h > 0) dh.value = h;
}

function setWidgetValue(node, name, value) {
  const w = getWidget(node, name);
  if (!w || w.value === value) return;
  // Value writes delegate to the reactive WidgetValueStore (frontend >= 1.55),
  // so the Vue BoundingBoxes editor resizes the canvas on its own. We
  // deliberately do NOT call the widget callback here: the core int callback
  // re-rounds the value to the widget's step multiple (16), which would
  // desync the canvas from the exact ResolutionSelector output.
  w.value = value;
}

function applyDims(node, w, h) {
  if (!(w > 0 && h > 0)) return;
  setWidgetValue(node, "width", w);
  setWidgetValue(node, "height", h);
  syncMirror(node);
}

// Python round() rounds ties to even; JS Math.round rounds ties toward +Inf.
// Match the server's ResolutionSelector exactly at .5 boundaries.
function pyRound(x) {
  const r = Math.round(x);
  if (Math.abs(x * 2 - r * 2) === 1 && r % 2 !== 0) return r - 1;
  return r;
}

// Mirror of comfy_extras/nodes_resolution.py ResolutionSelector.execute().
function resolutionSelectorDims(rs) {
  const ar = getWidget(rs, "aspect_ratio")?.value;
  const mp = getWidget(rs, "megapixels")?.value;
  const mult = getWidget(rs, "multiple")?.value;
  if (typeof mp !== "number" || !(mp > 0)) return null;
  if (!Number.isInteger(mult) || !(mult > 0)) return null;
  const m = typeof ar === "string" ? ar.match(/^\s*(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/) : null;
  if (!m) return null;
  const wr = parseFloat(m[1]);
  const hr = parseFloat(m[2]);
  if (!(wr > 0 && hr > 0)) return null;
  const scale = Math.sqrt((mp * 1024 * 1024) / (wr * hr));
  const w = pyRound((wr * scale) / mult) * mult;
  const h = pyRound((hr * scale) / mult) * mult;
  return w > 0 && h > 0 ? [w, h] : null;
}

function linkOrigin(node, inputName) {
  const input = node.inputs?.find((i) => i.name === inputName);
  if (!input || input.link == null) return null;
  const link = app.graph?.links?.[input.link];
  return link ? { id: link.origin_id, slot: link.origin_slot } : null;
}

// Tier-1 INT sources: the output value IS one of the node's own widgets, so
// the frontend can mirror it live without running anything.
// type -> { outputSlot: widgetName | { widget, resolve(widget) -> number } }
const INT_WIDGET_SOURCES = {
  PrimitiveInt: { 0: "value" },
  SeedNode: { 0: "seed" },
  CustomCombo: {
    1: { widget: "choice", resolve: (w) => (w.options?.values ?? []).indexOf(w.value) },
  },
  ColorToRGBInt: {
    0: {
      widget: "color",
      resolve: (w) => {
        const m = typeof w.value === "string" ? w.value.match(/^#?([0-9a-fA-F]{6})$/) : null;
        return m ? parseInt(m[1], 16) : null;
      },
    },
  },
};

function sourceIntValue(src, outSlot) {
  if (src.comfyClass === RS_TYPE) {
    const dims = resolutionSelectorDims(src);
    return dims ? dims[outSlot] : null;
  }
  const entry = INT_WIDGET_SOURCES[src.comfyClass]?.[outSlot];
  if (!entry) return null;
  const w = getWidget(src, typeof entry === "string" ? entry : entry.widget);
  if (!w) return null;
  const v = typeof entry === "string" ? w.value : entry.resolve(w);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Per-input sync: each linked input follows ONLY its own source link. An
// unlinked input keeps its own widget value. The source output slot decides
// which value is used, so crossing outputs over is honored too.
function syncDimsFromSource(node, src) {
  let changed = false;
  for (const name of ["width", "height"]) {
    const org = linkOrigin(node, name);
    if (!org || org.id !== src.id) continue;
    const v = sourceIntValue(src, org.slot);
    if (!(v > 0)) continue;
    setWidgetValue(node, name, v);
    changed = true;
  }
  if (changed) syncMirror(node);
}

// Push a source node's current value(s) into every node linked to it
// (through either its width or height input).
function refreshTargetsFor(src) {
  for (const node of app.graph?._nodes ?? []) {
    if (node.comfyClass !== NODE_TYPE) continue;
    const wOrg = linkOrigin(node, "width");
    const hOrg = linkOrigin(node, "height");
    if ((wOrg && wOrg.id === src.id) || (hOrg && hOrg.id === src.id)) {
      syncDimsFromSource(node, src);
    }
  }
}

// The live-syncable source (ResolutionSelector or a Tier-1 widget-backed
// node) feeding this node's width and/or height input, if any.
function sourceNodeFor(node, inputName) {
  const org = linkOrigin(node, inputName);
  if (!org) return null;
  const src = app.graph?.getNodeById?.(org.id);
  if (!src) return null;
  if (src.comfyClass === RS_TYPE) return src;
  return INT_WIDGET_SOURCES[src.comfyClass]?.[org.slot] ? src : null;
}

function syncFromSource(node) {
  for (const name of ["width", "height"]) {
    const src = sourceNodeFor(node, name);
    if (src) syncDimsFromSource(node, src);
  }
}

// Wrap a source node's widget callback so any change re-pushes into targets.
function wrapSourceWidget(node, wname) {
  const w = getWidget(node, wname);
  if (!w || w.__bboxSrcWrapped) return;
  const orig = w.callback;
  // function (not arrow) so the original callback keeps its `this`.
  w.callback = function (value, ...rest) {
    const r = orig?.call(this, value, ...rest);
    safe("refreshTargetsFor", () => refreshTargetsFor(node));
    return r;
  };
  w.__bboxSrcWrapped = true;
}

app.registerExtension({
  name: "jam.bbox.autorescale",
  nodeCreated(node) {
    // Live re-evaluation when a ResolutionSelector's widgets change.
    if (node.comfyClass === RS_TYPE) {
      for (const name of ["aspect_ratio", "megapixels", "multiple"]) {
        wrapSourceWidget(node, name);
      }
      return;
    }

    // Tier-1 sources (PrimitiveInt etc.): wrap the widgets their INT output
    // mirrors, so edits push into linked AutoRescale nodes immediately.
    const srcSpec = INT_WIDGET_SOURCES[node.comfyClass];
    if (srcSpec) {
      for (const entry of Object.values(srcSpec)) {
        wrapSourceWidget(node, typeof entry === "string" ? entry : entry.widget);
      }
      return;
    }

    if (node.comfyClass !== NODE_TYPE) return;

    // Same minimum size as the core createBoundingBoxes extension.
    safe("setSize", () => {
      const [oldWidth, oldHeight] = node.size;
      node.setSize([Math.max(oldWidth, 420), Math.max(oldHeight, 560)]);
    });

    // Hide internal widgets (values still serialize). Also clear the
    // `advanced` flag so the frontend does not render the
    // "show advanced inputs" footer button — we have no visible advanced
    // inputs, and the toggle would show nothing.
    safe("hideWidgets", () => {
      for (const widget of node.widgets ?? []) {
        if (!INTERNAL_WIDGETS.has(widget.name)) continue;
        widget.hidden = true;
        widget.options = widget.options || {};
        widget.options.hidden = true;
        widget.options.advanced = false;
      }
    });

    // Mirror width/height widget values into draw_width/draw_height on every
    // change (manual edit, background-image auto-size, anything else).
    for (const name of ["width", "height"]) {
      const w = getWidget(node, name);
      if (!w) continue;
      const orig = w.callback;
      // function (not arrow) so the original callback keeps its `this`.
      w.callback = function (value, ...rest) {
        const r = orig?.call(this, value, ...rest);
        safe("syncMirror", () => syncMirror(node));
        return r;
      };
    }

    // When a link is (re)connected into width/height, adopt the source dims
    // immediately if it is a ResolutionSelector.
    const origOcc = node.onConnectionsChange;
    node.onConnectionsChange = function (linkType, slot, linked, linkInfo, inputInfo) {
      const r = origOcc?.call(this, linkType, slot, linked, linkInfo, inputInfo);
      if (linked && linkType === 1) {
        setTimeout(() => safe("syncFromSource", () => syncFromSource(node)), 0);
      }
      return r;
    };

    // Initial sync after the node is fully configured (covers loaded graphs
    // where a ResolutionSelector is already linked).
    setTimeout(() => safe("syncFromSource", () => syncFromSource(node)), 0);
  },
});

// Fallback for non-ResolutionSelector sources: after a run, adopt the
// effective (linked) dims as the canvas size. The server's "executed"
// message carries the node's ui dict directly in `output` (execution.py:
// "output": enriched_output_ui), so dims live at detail.output.dims;
// keep the output.ui.dims shape as a fallback.
app.api.addEventListener("executed", (e) => {
  safe("executed-sync", () => {
    const detail = e?.detail;
    const dims = detail?.output?.dims ?? detail?.output?.ui?.dims;
    if (!Array.isArray(dims) || dims.length !== 2) return;
    const nodeId = Number(detail.node ?? detail.node_id);
    if (!Number.isFinite(nodeId)) return;
    const node = app.graph?.getNodeById?.(nodeId);
    if (!node || node.comfyClass !== NODE_TYPE) return;
    applyDims(node, dims[0], dims[1]);
  });
});
