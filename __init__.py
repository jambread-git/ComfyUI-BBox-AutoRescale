"""
Create Bounding Boxes (Auto-Rescale)

A drop-in clone of comfy-core's CreateBoundingBoxes node that fixes the
ResolutionSelector pitfall:

  The canvas editor stores boxes in the pixel space of the node's own
  width/height *widget values*. When those are overridden at runtime by a
  linked input (e.g. ResolutionSelector), the core node re-interprets the
  old pixel coordinates on the new canvas WITHOUT rescaling them, so the
  layout ends up squashed into part of the image.

This node keeps a mirror of the canvas drawing space (draw_width /
draw_height, maintained automatically by the companion frontend
extension, hidden from the UI) and proportionally rescales the saved
boxes at runtime whenever the effective width/height differ from it.

Behaviour is identical to the core node in every other respect:
- upstream `bboxes` input still re-initializes the canvas,
- canvas edits still take priority until upstream changes again,
- preview / bboxes / elements outputs are the same.
"""

from comfy_api.latest import ComfyExtension, io
import comfy_extras.nodes_bounding_boxes as bb

NODE_TYPE = "CreateBoundingBoxesAutoRescale"


def _rescale_boxes(boxes, old_w, old_h, new_w, new_h):
    """Proportionally rescale pixel-space boxes from (old_w, old_h) to (new_w, new_h)."""
    sx = new_w / old_w
    sy = new_h / old_h
    out = []
    for b in boxes:
        if not isinstance(b, dict):
            out.append(b)
            continue
        x = max(0, min(round(b.get("x", 0) * sx), new_w - 1))
        y = max(0, min(round(b.get("y", 0) * sy), new_h - 1))
        w = max(1, min(round(b.get("width", 0) * sx), new_w - x))
        h = max(1, min(round(b.get("height", 0) * sy), new_h - y))
        nb = dict(b)
        nb.update({"x": x, "y": y, "width": w, "height": h})
        out.append(nb)
    return out


class CreateBoundingBoxesAutoRescale(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        editor_state = io.BoundingBoxes.Input(
            "editor_state",
            socketless=False,
            tooltip="Draw bounding boxes and set each box type, text, description, color palette. Start with background element first and foreground last. Boxes are stored in the canvas space you drew them in and are auto-rescaled to the effective (linked) width/height at run time.",
        )
        return io.Schema(
            node_id=NODE_TYPE,
            display_name="Create Bounding Boxes (Auto-Rescale)",
            category="utilities",
            description="Same as Create Bounding Boxes, but when width/height come from a linked input (e.g. ResolutionSelector) and differ from the size the boxes were drawn in, the boxes are proportionally rescaled instead of being re-interpreted as-is.",
            inputs=[
                io.Image.Input(
                    "background",
                    optional=True,
                    tooltip="Optional image used as background in the canvas and preview.",
                ),
                io.MultiType.Input(
                    "bboxes",
                    [io.BoundingBox, io.Array, io.String],
                    optional=True,
                    tooltip="Bounding boxes, elements, or a JSON string to initialize the canvas. A new upstream value initializes the canvas; edits made on the canvas take priority and are kept until the upstream value changes again.",
                ),
                io.Int.Input("width", default=1024, min=64, max=16384, step=16,
                             tooltip="Width of the canvas and the pixel grid for the bounding boxes. Connect ResolutionSelector or any INT source here."),
                io.Int.Input("height", default=1024, min=64, max=16384, step=16,
                             tooltip="Height of the canvas and the pixel grid for the bounding boxes. Connect ResolutionSelector or any INT source here."),
                editor_state,
                io.BoundingBoxes.Input(
                    "last_incoming",
                    optional=True,
                    tooltip="Internal state managed by the canvas: the upstream bboxes value that last initialized it. Leave empty to re-initialize the canvas from the bboxes input on the next run.",
                ),
                io.Int.Input(
                    "draw_width", default=0, min=0, max=16384,
                    tooltip="Internal use, managed automatically by the canvas frontend: the width the saved boxes were drawn in. Hidden from the UI; set to 0 to disable auto-rescale.",
                ),
                io.Int.Input(
                    "draw_height", default=0, min=0, max=16384,
                    tooltip="Internal use, managed automatically by the canvas frontend: the height the saved boxes were drawn in. Hidden from the UI; set to 0 to disable auto-rescale.",
                ),
            ],
            outputs=[
                io.Image.Output(display_name="preview"),
                io.BoundingBox.Output(display_name="bboxes"),
                io.Array.Output(display_name="elements"),
            ],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, width, height, editor_state=None, last_incoming=None, background=None, bboxes=None,
                draw_width=0, draw_height=0) -> io.NodeOutput:
        # The canvas always keeps editor_state in the pixel space of the current
        # width/height *widget values* (the drawing space, mirrored here as
        # draw_width/draw_height). If the effective size differs (linked input),
        # rescale the saved boxes proportionally before anything else.
        if (
            editor_state
            and draw_width > 0 and draw_height > 0
            and (draw_width, draw_height) != (width, height)
        ):
            editor_state = _rescale_boxes(editor_state, draw_width, draw_height, width, height)

        incoming = bb.boxes_from_input(bboxes, width, height)
        applied = last_incoming if isinstance(last_incoming, list) else []
        upstream_changed = bool(incoming) and incoming != applied
        source = incoming if upstream_changed else (editor_state or [])
        regions = bb.boxes_to_regions(source, width, height)
        preview = bb.render_preview(regions, width, height, bb._bg_from_image(background))
        ui = {"dims": [width, height]}
        if incoming:
            ui["input_bboxes"] = incoming
        if background is not None and len(background) > 0:
            import nodes
            saved = nodes.PreviewImage().save_images(background[:1], "comfy.bboxes.background")
            ui["background_images"] = saved["ui"]["images"]
        return io.NodeOutput(
            preview,
            bb.fractions_to_bbox_frame(regions, width, height),
            bb.build_elements(regions),
            ui=ui,
        )


class BBoxAutoRescaleExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [CreateBoundingBoxesAutoRescale]


async def comfy_entrypoint() -> BBoxAutoRescaleExtension:
    return BBoxAutoRescaleExtension()


WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "comfy_entrypoint", "WEB_DIRECTORY"]
