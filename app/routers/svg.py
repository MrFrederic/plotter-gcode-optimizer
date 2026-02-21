import json
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.optimizer import GcodeOptimizer
from app.state import jobs
from app.svg_converter import convert_svg_to_gcode
from app.routers.gcode import _apply_settings

router = APIRouter()


@router.post("/upload-svg")
async def upload_svg(
    file: UploadFile = File(...),
    settings: str = Form(default="{}"),
):
    """Convert an SVG file to plotter G-code, then parse it ready for optimisation."""
    content = await file.read()

    user_settings = json.loads(settings)

    try:
        gcode_text = convert_svg_to_gcode(content, user_settings)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"SVG conversion failed: {exc}") from exc

    opt = GcodeOptimizer()
    paths = opt.parse(gcode_text)
    _apply_settings(opt, user_settings)

    if not paths:
        raise HTTPException(
            status_code=422,
            detail="No drawable paths found in SVG. Ensure path elements are present.",
        )

    serializable_paths = [[{"x": p[0], "y": p[1]} for p in path.points] for path in paths]

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "uploaded",
        "original_gcode": gcode_text,
        "optimized_gcode": None,
        "paths": paths,
        "settings": user_settings,
        "z_up": opt.z_up,
        "z_down": opt.z_down,
        "feedrate": opt.feedrate,
        "travel_speed": opt.travel_speed,
        "z_speed": opt.z_speed,
        "gcode_header": opt.gcode_header,
        "gcode_footer": opt.gcode_footer,
    }
    return {"job_id": job_id, "paths": serializable_paths, "source": "svg"}
