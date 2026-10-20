# ComfyUI-BBox-AutoRescale

<p align="center">
  <img src="docs/preview.png" alt="Create Bounding Boxes (Auto-Rescale) node in action" width="820">
</p>

<details open>
<summary>🇬🇧 English</summary>

**Create Bounding Boxes (Auto-Rescale)** is a drop-in replacement for the core
Create Bounding Boxes node. Its canvas automatically follows the real size
coming from linked `width` / `height` inputs, and the whole editor lives
inside the node:

- **Auto-rescaling canvas** — resizes the moment a linked size changes
  (`ResolutionSelector`, `PrimitiveInt`, `SeedNode`, `CustomCombo`,
  `ColorToRGBInt` supported live; any other INT source after the first run).
  Boxes are always proportionally rescaled at run time.
- **In-node box editor** — drag to draw, drag inside to move, 8-way resize
  handles, double-click for inline description editing, `Del` to delete,
  `Alt+click` to select boxes hidden behind others.
- **obj / text tabs** — object boxes and text boxes, each with editable
  type / text / description.
- **Color palette** with per-box colors, a `+` button to add colors, and a
  grid-snap toggle.
- **Auto node height** — the node always fits its editor exactly, at any width.

Same widgets and outputs as the core node (preview / bboxes / elements), so
existing workflows keep working unchanged.

</details>

<details>
<summary>🇯🇵 日本語</summary>

**Create Bounding Boxes (Auto-Rescale)** は、コアの「Create Bounding Boxes」ノードの
そのまま差し替え可能な代替ノードです。接続された `width` / `height` 入力の実サイズに
キャンバスが自動で追随し、編集操作はすべてノード内で完結します。

- **自動リサイズキャンバス** — 接続先のサイズが変わったその瞬間にキャンバスもリサイズ
  （`ResolutionSelector`、`PrimitiveInt`、`SeedNode`、`CustomCombo`、`ColorToRGBInt` は
  実行を待たず即追従。他のINTソースも初回実行後に追従）。ボックスは実行時に常に
  正しく比例リスケールされます。
- **ノード内ボックスエディター** — ドラッグで新規作成、内側ドラッグで移動、
  8方向リサイズハンドル、ダブルクリックで説明のインライン編集、`Del`で削除、
  `Alt+クリック`で重なって隠れたボックスを選択。
- **obj / text タブ** — 物体ボックスとテキストボックスを切り替え、ボックスごとに
  type / text / description を編集できます。
- **カラーパレット** — ボックスごとの色指定、`+`ボタンでの色追加、グリッドスナップ対応。
- **ノード高さの自動追従** — どの幅にリサイズしても、エディター全体が常にぴったり収まります。

ウィジェットと出力（preview / bboxes / elements）はコアノードと同一なので、
既存のワークフローはそのまま動作します。

</details>

## Live canvas sync

The canvas resizes the MOMENT the size changes (no run needed) for:

- `ResolutionSelector` (both width/height outputs, formula mirrored client-side)
- `PrimitiveInt`, `SeedNode`, `CustomCombo`, `ColorToRGBInt` (widget-backed INT)

Each input follows ONLY its own link: an unlinked width/height keeps its own
widget value, so mixed setups (fixed width + selector-driven height) work.

For any other INT source, the canvas adopts the real executed size after the
first run (boxes are always rescaled correctly at run time regardless).

## Install

Install via the **Comfy Registry** (search `ComfyUI-BBox-AutoRescale`), or
extract the `ComfyUI-BBox-AutoRescale` folder into:

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
