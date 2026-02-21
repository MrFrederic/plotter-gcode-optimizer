"""
SVG to plotter G-code conversion using the svg2gcode library.

svg2gcode targets laser engravers and uses M3/M5 (laser on/off) rather than
Z-axis pen up/down movements.  This module wraps it and post-processes the
output to produce plotter-compatible G-code.
"""

import os
import re
import tempfile
import xml.etree.ElementTree as ET

from svg2gcode.svg_to_gcode.compiler import Compiler, interfaces
from svg2gcode.svg_to_gcode.svg_parser import parse_file

_SVG_NS = "http://www.w3.org/2000/svg"
_XLINK_NS = "http://www.w3.org/1999/xlink"

# Register known namespaces so ET.tostring doesn't add ns0:/ns1: prefixes
ET.register_namespace("", _SVG_NS)
ET.register_namespace("xlink", _XLINK_NS)
ET.register_namespace("dc", "http://purl.org/dc/elements/1.1/")
ET.register_namespace("cc", "http://creativecommons.org/ns#")
ET.register_namespace("rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#")
ET.register_namespace("sodipodi", "http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd")
ET.register_namespace("inkscape", "http://www.inkscape.org/namespaces/inkscape")


_POINTS_RE = re.compile(r"[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?")
_XML_DECL_RE = re.compile(r"<\?xml[^>]*\?>")

# Unit conversion factors to millimeters (1 unit = X mm)
# CSS reference pixel is 1/96 inch; pt is 1/72 inch
_UNIT_TO_MM = {
    "mm": 1.0,
    "cm": 10.0,
    "in": 25.4,
    "px": 25.4 / 96.0,  # CSS px at 96 DPI
    "pt": 25.4 / 72.0,
    "pc": 25.4 / 6.0,   # 1 pica = 12 pt = 1/6 inch
}


def _parse_length(s: str) -> tuple[float, str]:
    """Parse an SVG length value and return (number, unit).

    If no unit is specified, returns 'px' as the default (per SVG spec).
    """
    if s is None:
        return 0.0, "px"
    s = s.strip()
    match = re.match(r"^([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*([a-zA-Z%]*)$", s)
    if not match:
        return 0.0, "px"
    num = float(match.group(1))
    unit = match.group(2).lower() if match.group(2) else "px"
    return num, unit


def _length_to_mm(s: str) -> float:
    """Convert an SVG length string to millimeters."""
    num, unit = _parse_length(s)
    factor = _UNIT_TO_MM.get(unit, 25.4 / 96.0)  # Default to px if unknown
    return num * factor


def _f(s) -> float:
    """Parse a float, stripping common SVG unit suffixes."""
    if s is None:
        return 0.0
    return float(re.sub(r"[^0-9.\-+eE]", "", s) or "0")


def _copy_style_attrs(src: ET.Element, dst: ET.Element):
    """Copy presentation attributes (fill, stroke, style, …) from src to dst."""
    for attr in ("style", "fill", "stroke", "stroke-width", "fill-opacity",
                 "stroke-opacity", "opacity", "visibility", "display",
                 "transform", "class", "id"):
        v = src.get(attr)
        if v is not None:
            dst.set(attr, v)


def _rect_to_d(el: ET.Element) -> str:
    x = _f(el.get("x", "0"))
    y = _f(el.get("y", "0"))
    w = _f(el.get("width", "0"))
    h = _f(el.get("height", "0"))
    rx = _f(el.get("rx") or el.get("ry") or "0")
    ry = _f(el.get("ry") or el.get("rx") or "0")
    if rx == 0 and ry == 0:
        return f"M {x},{y} H {x+w} V {y+h} H {x} Z"
    rx = min(rx, w / 2)
    ry = min(ry, h / 2)
    return (
        f"M {x+rx},{y} L {x+w-rx},{y} A {rx},{ry} 0 0 1 {x+w},{y+ry} "
        f"L {x+w},{y+h-ry} A {rx},{ry} 0 0 1 {x+w-rx},{y+h} "
        f"L {x+rx},{y+h} A {rx},{ry} 0 0 1 {x},{y+h-ry} "
        f"L {x},{y+ry} A {rx},{ry} 0 0 1 {x+rx},{y} Z"
    )


def _circle_to_d(el: ET.Element) -> str:
    cx = _f(el.get("cx", "0"))
    cy = _f(el.get("cy", "0"))
    r = _f(el.get("r", "0"))
    return (
        f"M {cx-r},{cy} A {r},{r} 0 1 0 {cx+r},{cy} "
        f"A {r},{r} 0 1 0 {cx-r},{cy} Z"
    )


def _ellipse_to_d(el: ET.Element) -> str:
    cx = _f(el.get("cx", "0"))
    cy = _f(el.get("cy", "0"))
    rx = _f(el.get("rx", "0"))
    ry = _f(el.get("ry", "0"))
    return (
        f"M {cx-rx},{cy} A {rx},{ry} 0 1 0 {cx+rx},{cy} "
        f"A {rx},{ry} 0 1 0 {cx-rx},{cy} Z"
    )


def _line_to_d(el: ET.Element) -> str:
    x1 = _f(el.get("x1", "0"))
    y1 = _f(el.get("y1", "0"))
    x2 = _f(el.get("x2", "0"))
    y2 = _f(el.get("y2", "0"))
    return f"M {x1},{y1} L {x2},{y2}"


def _points_to_d(points_str: str, close: bool) -> str:
    nums = _POINTS_RE.findall(points_str)
    if len(nums) < 4:
        return ""
    coords = list(zip(nums[0::2], nums[1::2]))
    d = "M " + " L ".join(f"{x},{y}" for x, y in coords)
    return d + " Z" if close else d


_SHAPE_CONVERTERS = {
    f"{{{_SVG_NS}}}rect": _rect_to_d,
    f"{{{_SVG_NS}}}circle": _circle_to_d,
    f"{{{_SVG_NS}}}ellipse": _ellipse_to_d,
    f"{{{_SVG_NS}}}line": _line_to_d,
    f"{{{_SVG_NS}}}polyline": lambda el: _points_to_d(el.get("points", ""), False),
    f"{{{_SVG_NS}}}polygon": lambda el: _points_to_d(el.get("points", ""), True),
}


def _convert_shapes_in_tree(parent: ET.Element):
    """Recursively replace basic shape elements with <path> equivalents."""
    to_replace = []
    for i, child in enumerate(parent):
        if child.tag in _SHAPE_CONVERTERS:
            try:
                d = _SHAPE_CONVERTERS[child.tag](child)
            except (ValueError, KeyError, AttributeError):
                d = ""
            if d:
                path_el = ET.Element(f"{{{_SVG_NS}}}path")
                path_el.set("d", d)
                _copy_style_attrs(child, path_el)
                to_replace.append((i, child, path_el))
        else:
            _convert_shapes_in_tree(child)
    for i, old, new in reversed(to_replace):
        parent.remove(old)
        parent.insert(i, new)


def _preprocess_svg(svg_bytes: bytes) -> bytes:
    """Normalise SVG: convert basic shapes (rect, circle, …) to <path> elements."""
    try:
        text = svg_bytes.decode("utf-8", errors="replace")
        # Strip XML declaration so ET can re-emit cleanly
        text_clean = _XML_DECL_RE.sub("", text).strip()
        root = ET.fromstring(text_clean)
        _convert_shapes_in_tree(root)
        return ET.tostring(root, encoding="unicode").encode("utf-8")
    except ET.ParseError:
        # Malformed XML: return original bytes so svg2gcode can produce a clear error
        return svg_bytes


def _compute_viewbox_scale(svg_bytes: bytes) -> tuple[float, float] | None:
    """Compute the scale factor to convert viewBox units to mm.

    SVG coordinates are in viewBox units. To get the correct physical size,
    we need to scale them by (viewport size in mm) / (viewBox size).

    Returns:
        A tuple (scale_x, scale_y) or None if no scaling is needed.
    """
    try:
        text = svg_bytes.decode("utf-8", errors="replace")
        text_clean = _XML_DECL_RE.sub("", text).strip()
        root = ET.fromstring(text_clean)
    except ET.ParseError:
        return None

    viewbox_attr = root.get("viewBox")
    width_attr = root.get("width")
    height_attr = root.get("height")

    # If there's no viewBox, svg2gcode uses viewport dimensions directly (in user units)
    if not viewbox_attr:
        # No viewBox means coordinates are already in viewport space.
        # If viewport has units, we still need to convert to mm.
        if width_attr and height_attr:
            # Check if viewport has units that need conversion
            vp_width_mm = _length_to_mm(width_attr)
            vp_height_mm = _length_to_mm(height_attr)
            # Strip units to get the numeric viewport values
            vp_width_num, _ = _parse_length(width_attr)
            vp_height_num, _ = _parse_length(height_attr)
            if vp_width_num > 0 and vp_height_num > 0:
                scale_x = vp_width_mm / vp_width_num
                scale_y = vp_height_mm / vp_height_num
                # Only return scale if it differs from 1.0
                if abs(scale_x - 1.0) > 0.0001 or abs(scale_y - 1.0) > 0.0001:
                    return (scale_x, scale_y)
        return None

    # Parse viewBox: "min-x min-y width height"
    vb_parts = viewbox_attr.split()
    if len(vb_parts) < 4:
        return None

    try:
        vb_width = float(vb_parts[2])
        vb_height = float(vb_parts[3])
    except (ValueError, IndexError):
        return None

    if vb_width <= 0 or vb_height <= 0:
        return None

    # Get viewport dimensions in mm
    # If no viewport specified, assume viewBox dimensions are in mm (no scaling)
    if not width_attr or not height_attr:
        return None

    vp_width_mm = _length_to_mm(width_attr)
    vp_height_mm = _length_to_mm(height_attr)

    if vp_width_mm <= 0 or vp_height_mm <= 0:
        return None

    # Compute scale factors
    scale_x = vp_width_mm / vb_width
    scale_y = vp_height_mm / vb_height

    # Only return scale if it actually differs from 1.0
    if abs(scale_x - 1.0) < 0.0001 and abs(scale_y - 1.0) < 0.0001:
        return None

    return (scale_x, scale_y)


def convert_svg_to_gcode(svg_bytes: bytes, settings: dict) -> str:
    """Convert SVG content to plotter G-code.

    Steps:
    1. Pre-process: convert basic shapes to <path> elements.
    2. Write the SVG bytes to a temporary file (svg2gcode requires a file path).
    3. Parse the SVG into curves and compile to laser G-code in memory.
    4. Post-process: replace M3/M5 laser commands with Z-axis pen movements.

    Args:
        svg_bytes: Raw bytes of the SVG file.
        settings:  Dict with optional keys: z_up, z_down, feedrate, curve_tolerance.

    Returns:
        Plotter-compatible G-code as a string.

    Raises:
        ValueError: If the SVG contains no drawable path elements.
    """
    z_up = float(settings.get("z_up", 2.0))
    z_down = float(settings.get("z_down", 0.0))
    feedrate = int(settings.get("feedrate") or 1000)
    # curve_tolerance maps to svg2gcode pixel_size (curve discretization step in mm)
    curve_tolerance = float(settings.get("curve_tolerance") or 0.1)

    # Normalise shapes → paths before handing to svg2gcode
    processed_svg = _preprocess_svg(svg_bytes)

    # Compute scale factor to convert viewBox units to mm
    # This corrects the common case where viewBox dimensions differ from viewport dimensions
    scale_factor = _compute_viewbox_scale(svg_bytes)

    # svg2gcode's parse_file requires an actual file path, so we still need a
    # temporary file for the SVG input — but we compile entirely in memory to
    # avoid the issue where compile_to_file silently skips writing the output
    # file when no path body is generated.
    with tempfile.TemporaryDirectory() as tmpdir:
        svg_path = os.path.join(tmpdir, "input.svg")
        with open(svg_path, "wb") as f:
            f.write(processed_svg)

        compiler = Compiler(
            interfaces.Gcode,
            params={
                "laser_power": 0,
                "movement_speed": feedrate,
                "pixel_size": curve_tolerance,
                "maximum_image_laser_power": 0,
                "image_movement_speed": feedrate,
                "fan": False,
                "rapid_move": 10,
                "showimage": False,
                "x_axis_maximum_travel": 0,
                "y_axis_maximum_travel": 0,
                "image_noise": 0,
                "pass_depth": 0,
                "laser_mode": "constant",
                "splitfile": False,
                "pathcut": True,
                "nofill": True,
                "image_poweroffset": 0,
                "image_overscan": 0,
                "image_showoverscan": False,
                "color_coded": "",
            },
        )

        # draw_hidden=True includes paths with display/visibility styling applied
        # scale_factor converts viewBox units to mm based on viewport dimensions
        curves = parse_file(svg_path, draw_hidden=True, scale_factor=scale_factor)
        # Set svg_file_name so gcode_file_header() has access to the source path
        compiler.svg_file_name = svg_path
        compiler.append_curves(curves)

        body = compiler.compile()
        if not body:
            raise ValueError(
                "No drawable path elements found in the SVG. "
                "Make sure the file contains path, rect, circle or other shape elements."
            )

        header = "\n".join(compiler.header) + "\n"
        footer = "\n".join(compiler.footer) + "\n"
        raw_gcode = compiler.gcode_file_header() + header + body + "\n" + footer

    return _laser_to_plotter(raw_gcode, z_up=z_up, z_down=z_down)


def _laser_to_plotter(gcode: str, z_up: float, z_down: float) -> str:
    """Replace laser on/off commands with pen up/down Z movements."""
    lines = []
    for line in gcode.splitlines():
        stripped = line.strip()

        # Skip blank lines and comment-only lines
        if not stripped or stripped.startswith(";"):
            lines.append(line)
            continue

        # M3 Sxxx  →  G0 Z{z_down}  (laser on = pen down)
        if re.match(r"^M3\b", stripped, re.IGNORECASE):
            lines.append(f"G0 Z{z_down:.2f}")
            continue

        # M4 Sxxx  →  G0 Z{z_down}  (dynamic laser on = pen down)
        if re.match(r"^M4\b", stripped, re.IGNORECASE):
            lines.append(f"G0 Z{z_down:.2f}")
            continue

        # M5 / M9  →  G0 Z{z_up}   (laser off = pen up)
        if re.match(r"^M5\b", stripped, re.IGNORECASE) or re.match(
            r"^M9\b", stripped, re.IGNORECASE
        ):
            lines.append(f"G0 Z{z_up:.2f}")
            continue

        lines.append(line)

    return "\n".join(lines)
