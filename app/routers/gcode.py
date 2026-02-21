import asyncio
import json
import uuid

from fastapi import APIRouter, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse

from app.optimizer import GcodeOptimizer
from app.state import jobs

router = APIRouter()


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    settings: str = Form(default="{}"),
):
    content = await file.read()
    gcode_text = content.decode("utf-8")

    user_settings = json.loads(settings)

    opt = GcodeOptimizer()
    paths = opt.parse(gcode_text)
    _apply_settings(opt, user_settings)

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
        "max_iterations": opt.max_iterations,
        "gcode_header": opt.gcode_header,
        "gcode_footer": opt.gcode_footer,
    }
    return {"job_id": job_id, "paths": serializable_paths}


@router.websocket("/ws/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    await websocket.accept()
    if job_id not in jobs:
        await websocket.close()
        return

    job = jobs[job_id]
    opt = GcodeOptimizer()
    opt.z_up = job["z_up"]
    opt.z_down = job["z_down"]
    opt.feedrate = job["feedrate"]
    opt.travel_speed = job["travel_speed"]
    opt.z_speed = job["z_speed"]
    opt.max_iterations = job["max_iterations"]
    opt.gcode_header = job["gcode_header"]
    opt.gcode_footer = job["gcode_footer"]
    paths = job["paths"]

    await websocket.send_json({"type": "log", "msg": "Initializing CyberPlotter Core..."})
    await asyncio.sleep(0.5)

    await websocket.send_json(
        {
            "type": "log",
            "msg": f"Loaded {len(paths)} paths. Z-Down: {opt.z_down}, Z-Up: {opt.z_up}",
        }
    )

    await websocket.send_json(
        {"type": "log", "msg": "Deploying Greedy Nearest-Neighbor heuristic..."}
    )

    async def progress(phase, current, total, latest_path=None):
        if phase == 1:
            if latest_path:
                pts = [{"x": p[0], "y": p[1]} for p in latest_path.points]
                await websocket.send_json(
                    {
                        "type": "progress",
                        "phase": 1,
                        "current": current,
                        "total": total,
                        "latest_path": pts,
                    }
                )
                await asyncio.sleep(0.01)
        elif phase == 2:
            await websocket.send_json(
                {
                    "type": "log",
                    "msg": "Phase 1 complete. Initializing 2-Opt refinement subsystem...",
                }
            )
            await asyncio.sleep(0.3)
            await websocket.send_json(
                {"type": "log", "msg": "Loading native path-inversion kernels..."}
            )
            await asyncio.sleep(0.2)
            await websocket.send_json(
                {"type": "log", "msg": "Executing bidirectional route optimization..."}
            )
        elif phase == 3:
            pass  # handled below

    result = await opt.optimize(paths, progress_callback=progress)
    optimized_paths = result["paths"]
    stats = result["stats"]

    phase1_base = stats["phase1_penup_dist"]
    savings_pct = 0
    if phase1_base > 0:
        savings_pct = (1 - stats["final_penup_dist"] / phase1_base) * 100

    await websocket.send_json(
        {
            "type": "log",
            "msg": f"2-Opt converged: {stats['phase2_iterations']} iterations",
        }
    )
    await websocket.send_json(
        {
            "type": "log",
            "msg": (
                f"Travel: {stats['original_penup_dist']:.1f}mm (gcode) -> "
                f"{phase1_base:.1f}mm (NN) -> {stats['final_penup_dist']:.1f}mm "
                f"({savings_pct:.1f}% NN refinement)"
            ),
        }
    )

    paths_data = [[{"x": p[0], "y": p[1]} for p in path.points] for path in optimized_paths]
    full_history = stats["phase2_dist_history"]

    await websocket.send_json(
        {
            "type": "phase2_result",
            "iterations": stats["phase2_iterations"],
            "dist_history": full_history,
            "paths": paths_data,
            "original_dist": phase1_base,
            "gcode_dist": stats["original_penup_dist"],
            "phase1_dist": phase1_base,
            "final_dist": stats["final_penup_dist"],
        }
    )

    await websocket.send_json({"type": "log", "msg": "Generating optimized G-code..."})
    final_gcode = opt.generate(optimized_paths)
    job["optimized_gcode"] = final_gcode
    job["status"] = "completed"

    await websocket.send_json({"type": "complete", "job_id": job_id})


@router.get("/download/{job_id}")
async def download(job_id: str):
    if job_id in jobs and jobs[job_id]["optimized_gcode"]:
        return PlainTextResponse(
            jobs[job_id]["optimized_gcode"],
            headers={
                "Content-Disposition": f"attachment; filename=optimized_{job_id[:8]}.gcode"
            },
        )
    return {"error": "Job not found or not completed"}


def _apply_settings(opt: GcodeOptimizer, settings: dict):
    """Override optimizer parameters with user-provided settings."""
    if "z_up" in settings:
        opt.z_up = float(settings["z_up"])
    if "z_down" in settings:
        opt.z_down = float(settings["z_down"])
    if "feedrate" in settings:
        opt.feedrate = float(settings["feedrate"])
    if "travel_speed" in settings:
        opt.travel_speed = float(settings["travel_speed"])
    if "z_speed" in settings:
        opt.z_speed = float(settings["z_speed"])
    if "max_iterations" in settings:
        opt.max_iterations = max(50, min(1000, int(settings["max_iterations"])))
    if "gcode_header" in settings:
        opt.gcode_header = str(settings["gcode_header"])
    if "gcode_footer" in settings:
        opt.gcode_footer = str(settings["gcode_footer"])
