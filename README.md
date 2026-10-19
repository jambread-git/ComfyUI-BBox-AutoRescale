# ComfyUI-BBox-AutoRescale

A drop-in variant of the core **Create Bounding Boxes** node whose canvas
automatically follows the size coming from linked `width` / `height` inputs.

ノードに接続された `width` / `height` 入力の実サイズに、キャンバスが自動で
追随する「Create Bounding Boxes」派生ノードです。

## Node

- **Create Bounding Boxes (Auto-Rescale)** (`CreateBoundingBoxesAutoRescale`)
  - Same widgets and outputs as the core node (preview / bboxes / elements).
  - When the effective width/height differ from the drawn canvas size, all
    boxes are proportionally rescaled to the effective size at run time.

## Live canvas sync

The canvas resizes the MOMENT the size changes (no run needed) for:

- `ResolutionSelector` (both width/height outputs, formula mirrored client-side)
- `PrimitiveInt`, `SeedNode`, `CustomCombo`, `ColorToRGBInt` (widget-backed INT)

Each input follows ONLY its own link: an unlinked width/height keeps its own
widget value, so mixed setups (fixed width + selector-driven height) work.

For any other INT source, the canvas adopts the real executed size after the
first run (boxes are always rescaled correctly at run time regardless).

## Install

Extract the `ComfyUI-BBox-AutoRescale` folder into:

```
ComfyUI/custom_nodes/ComfyUI-BBox-AutoRescale
```

Restart ComfyUI. No Python dependencies required (ComfyUI core only).
Recent ComfyUI versions also accept dropping the `.zip` directly into
`custom_nodes/`.

## Notes

- `draw_width` / `draw_height` are internal (hidden) parameters that record
  the size the boxes were drawn at. Do not edit them manually.
- Requires a ComfyUI version that ships the core Bounding Boxes nodes
  (`comfy_extras/nodes_bounding_boxes.py`).
