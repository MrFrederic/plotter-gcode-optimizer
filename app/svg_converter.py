"""
SVG to plotter G-code conversion using the svg2gcode library.

svg2gcode targets laser engravers and uses M3/M5 (laser on/off) rather than
Z-axis pen up/down movements.  This module wraps it and post-processes the
output to produce plotter-compatible G-code.
"""

import os
import re
import tempfile

from svg2gcode.svg_to_gcode.compiler import Compiler, interfaces
from svg2gcode.svg_to_gcode.svg_parser import parse_file


def convert_svg_to_gcode(svg_bytes: bytes, settings: dict) -> str:
    """Convert SVG content to plotter G-code.

    Steps:
    1. Write the SVG bytes to a temporary file.
    2. Use svg2gcode to parse the SVG and compile to laser G-code.
    3. Post-process: replace M3/M5 laser commands with Z-axis pen movements.

    Args:
        svg_bytes: Raw bytes of the SVG file.
        settings:  Dict with optional keys: z_up, z_down, feedrate, cutting_speed.

    Returns:
        Plotter-compatible G-code as a string.
    """
    z_up = float(settings.get("z_up", 2.0))
    z_down = float(settings.get("z_down", 0.0))
    feedrate = int(settings.get("feedrate") or 1000)
    # curve_tolerance maps to svg2gcode pixel_size (curve discretization step in mm)
    curve_tolerance = float(settings.get("curve_tolerance") or 0.1)

    with tempfile.TemporaryDirectory() as tmpdir:
        svg_path = os.path.join(tmpdir, "input.svg")
        gcode_path = os.path.join(tmpdir, "output.gcode")

        with open(svg_path, "wb") as f:
            f.write(svg_bytes)

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

        curves = parse_file(svg_path)
        compiler.compile_to_file(gcode_path, svg_path, curves)

        with open(gcode_path, "r") as f:
            raw_gcode = f.read()

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
