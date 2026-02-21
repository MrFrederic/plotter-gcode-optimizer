import asyncio
import json
import uuid

from fastapi import APIRouter, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse

from app.optimizer import GcodeOptimizer
from app.state import jobs
from app.line_filter import apply_pen_filter

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
    opt.gcode_header = job["gcode_header"]
    opt.gcode_footer = job["gcode_footer"]
    paths = job["paths"]

    await websocket.send_json({"type": "log", "msg": "Initializing PlotterTool Core..."})
    await asyncio.sleep(0.5)

    await websocket.send_json(
        {
            "type": "log",
            "msg": f"Loaded {len(paths)} paths. Z-Down: {opt.z_down}, Z-Up: {opt.z_up}",
        }
    )

    # ── Line filter phase ────────────────────────────────────────────────────
    settings = job.get("settings", {})
    pw = float(settings.get("pen_width", 0))
    if pw > 0:
        vt = float(settings.get("visibility_threshold", 50))
        await websocket.send_json(
            {"type": "log", "msg": "Initializing coverage analysis subsystem..."}
        )
        await websocket.send_json(
            {
                "type": "filter_start",
                "path_count": len(paths),
                "pen_width": pw,
                "visibility_threshold": vt,
            }
        )

        # Run the actual filter
        filtered, filter_stats = apply_pen_filter(paths, settings)
        removed_count = filter_stats["removed_count"] if filter_stats else 0

        await websocket.send_json(
            {
                "type": "filter_result",
                "original_count": len(paths),
                "removed_count": removed_count,
                "kept_count": len(filtered),
                "removed_indices": filter_stats["removed_indices"] if filter_stats else [],
                "pen_width": pw,
                "visibility_threshold": vt,
            }
        )

        paths = filtered
        job["paths"] = paths

        await websocket.send_json(
            {
                "type": "log",
                "msg": f"Coverage scan: {removed_count} paths eliminated, {len(paths)} remaining",
            }
        )

    await websocket.send_json(
        {"type": "log", "msg": "Deploying Greedy Nearest-Neighbor heuristic..."}
    )

    # ── Phase 1: Greedy Sort ─────────────────────────────────────────────────
    original_dist = opt.calculate_penup_distance(paths)
    greedy_paths, greedy_history = opt.greedy_sort(paths)
    phase1_dist = opt.calculate_penup_distance(greedy_paths)
    
    # Serialize greedy results for UI
    greedy_paths_data = [[{"x": p[0], "y": p[1]} for p in path.points] for path in greedy_paths]
    
    await websocket.send_json(
        {
            "type": "greedy_result",
            "paths": greedy_paths_data,
            "progress_history": greedy_history,
            "original_dist": original_dist,
            "phase1_dist": phase1_dist,
            "path_count": len(greedy_paths)
        }
    )
    
    await websocket.send_json(
        {
            "type": "log",
            "msg": f"Greedy sort complete: {original_dist:.1f}mm → {phase1_dist:.1f}mm travel",
        }
    )

    # ── Path Merging (optional) ──────────────────────────────────────────────
    merge_threshold = float(settings.get("merge_threshold", 0))
    paths_to_optimize = greedy_paths
    
    if merge_threshold > 0:
        await websocket.send_json(
            {"type": "log", "msg": f"Merging adjacent paths (threshold: {merge_threshold:.2f}mm)..."}
        )
        
        merged_paths, merge_stats = opt.merge_adjacent_paths(greedy_paths, merge_threshold)
        
        if merge_stats["merge_count"] > 0:
            post_merge_dist = opt.calculate_penup_distance(merged_paths)
            
            # Serialize merged results for UI
            merged_paths_data = [[{"x": p[0], "y": p[1]} for p in path.points] for path in merged_paths]
            
            await websocket.send_json(
                {
                    "type": "merge_result",
                    "paths": merged_paths_data,
                    "original_count": merge_stats["original_count"],
                    "merged_count": merge_stats["merged_count"],
                    "merge_count": merge_stats["merge_count"],
                    "post_merge_dist": post_merge_dist,
                }
            )
            
            await websocket.send_json(
                {
                    "type": "log",
                    "msg": f"Merged {merge_stats['merge_count']} path pairs: {merge_stats['original_count']} → {merge_stats['merged_count']} paths",
                }
            )
            
            paths_to_optimize = merged_paths
            phase1_dist = post_merge_dist
        else:
            await websocket.send_json(
                {"type": "log", "msg": "No paths within merge threshold"}
            )

    # ── Phase 2: 2-OPT (runs in background thread) ───────────────────────────
    await websocket.send_json(
        {"type": "log", "msg": "Starting 2-Opt refinement..."}
    )
    
    # Notify UI that 2-OPT is starting
    await websocket.send_json({"type": "twoopt_start", "estimated_paths": len(paths_to_optimize)})
    
    # Run 2-OPT in thread pool to not block
    import concurrent.futures
    loop = asyncio.get_event_loop()
    
    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = loop.run_in_executor(executor, opt.two_opt_sync, paths_to_optimize)
        
        # Keep websocket alive during long operation by sending periodic pings
        while not future.done():
            try:
                await asyncio.wait_for(asyncio.shield(future), timeout=5.0)
            except asyncio.TimeoutError:
                # Send a lightweight keepalive message to prevent timeout
                try:
                    await websocket.send_json({"type": "ping"})
                except:
                    pass
        
        optimized_paths, twoopt_stats = await future

    iterations = twoopt_stats["iterations"]
    full_history = twoopt_stats["dist_history"]
    final_dist = twoopt_stats["final_dist"]

    savings_pct = 0
    if phase1_dist > 0:
        savings_pct = (1 - final_dist / phase1_dist) * 100

    await websocket.send_json(
        {
            "type": "log",
            "msg": f"2-Opt converged: {iterations} iterations",
        }
    )
    await websocket.send_json(
        {
            "type": "log",
            "msg": (
                f"Travel: {original_dist:.1f}mm (gcode) → "
                f"{phase1_dist:.1f}mm (NN) → {final_dist:.1f}mm "
                f"({savings_pct:.1f}% NN refinement)"
            ),
        }
    )

    paths_data = [[{"x": p[0], "y": p[1]} for p in path.points] for path in optimized_paths]

    await websocket.send_json(
        {
            "type": "phase2_result",
            "iterations": iterations,
            "dist_history": full_history,
            "paths": paths_data,
            "original_dist": phase1_dist,
            "gcode_dist": original_dist,
            "phase1_dist": phase1_dist,
            "final_dist": final_dist,
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
    if "gcode_header" in settings:
        opt.gcode_header = str(settings["gcode_header"])
    if "gcode_footer" in settings:
        opt.gcode_footer = str(settings["gcode_footer"])
