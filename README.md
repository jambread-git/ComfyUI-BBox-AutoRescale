# ComfyUI-BBox-AutoRescale

![Version](https://img.shields.io/badge/version-1.0.3-2ea44f?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![ComfyUI](https://img.shields.io/badge/ComfyUI-custom%20nodes-6f42c1?style=flat-square)

**Create Bounding Boxes (Auto-Rescale)** is a drop-in replacement for the core
Create Bounding Boxes node. Its canvas automatically follows the real size
coming from linked `width` / `height` inputs, and the whole box editor lives
inside the node.

Published on the **Comfy Registry** as `comfyui-bbox-autorescale`, so it can
be discovered and installed from **ComfyUI Manager**.

> Unofficial community project. This project is not affiliated with or endorsed by Comfy Org.

**Languages:** [English](README.md) · [日本語](README.ja.md)

---

<p align="center">
  <img src="docs/preview.png" alt="Create Bounding Boxes (Auto-Rescale) node in action" width="820">
</p>

## What this node does

- **Auto-rescaling canvas** — the canvas resizes the MOMENT a linked size
  changes (no run needed). Supported live sources: `ResolutionSelector`,
  `PrimitiveInt`, `SeedNode`, `CustomCombo`, `ColorToRGBInt`. Any other INT
  source is adopted after the first run. Boxes are always proportionally
  rescaled at run time, so saved boxes never drift.
- **In-node box editor** — drag on empty canvas to draw a box, drag inside to
  move, 8-way resize handles, double-click for inline description editing,
  `Del` to delete, `Alt+click` to select a box hidden behind another.
- **obj / text tabs** — object boxes and text boxes, each with editable
  type / text / description.
- **Color palette** — per-box colors, a `+` button to add colors, and a
  grid-snap toggle.
- **Auto node height** — whatever width you resize the node to, the canvas and
  all controls always fit exactly; nothing is clipped even at minimum size.
- **Faithful persistence** — saved node sizes are restored intact across
  workflow-tab switches and ComfyUI restarts.
- Works in classic (non-frontend) UI as well.

Same widgets and outputs as the core node (preview / bboxes / elements), so
existing workflows keep working unchanged.

## Live canvas sync

Each input follows ONLY its own link: an unlinked width/height keeps its own
widget value, so mixed setups (fixed width + selector-driven height) work.

For any other INT source, the canvas adopts the real executed size after the
first run (boxes are always rescaled correctly at run time regardless).

## Install

**ComfyUI Manager:** search for `ComfyUI-BBox-AutoRescale` or
`comfyui-bbox-autorescale` and install it directly.

**Manual installation:** copy the `ComfyUI-BBox-AutoRescale` folder into
`ComfyUI/custom_nodes/`, then restart ComfyUI. No Python dependencies
required (ComfyUI core only). Recent ComfyUI versions also accept dropping
the `.zip` directly into `custom_nodes/`.

After restart, search the node palette for
"Create Bounding Boxes (Auto-Rescale)".

## Notes

- `draw_width` / `draw_height` are internal (hidden) parameters that record
  the size the boxes were drawn at. Do not edit them manually.
- Requires a ComfyUI version that ships the core Bounding Boxes nodes
  (`comfy_extras/nodes_bounding_boxes.py`).

## License

MIT License. See `LICENSE`.
