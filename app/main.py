from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from app.optimizer import GcodeOptimizer
import asyncio
import uuid
import json

app = FastAPI()

app.mount("/static", StaticFiles(directory="app/static"), name="static")

# In-memory storage for jobs
jobs = {}

@app.get("/")
async def get():
    with open("app/static/index.html") as f:
        return HTMLResponse(f.read())

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    content = await file.read()
    gcode_text = content.decode('utf-8')
    
    opt = GcodeOptimizer()
    paths = opt.parse(gcode_text)
    serializable_paths = [[{"x": p[0], "y": p[1]} for p in path.points] for path in paths]
    
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "uploaded",
        "original_gcode": gcode_text,
        "optimized_gcode": None,
        "paths": paths
    }
    return {"job_id": job_id, "paths": serializable_paths}

@app.websocket("/ws/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    await websocket.accept()
    if job_id not in jobs:
        await websocket.close()
        return
        
    job = jobs[job_id]
    opt = GcodeOptimizer()
    paths = job["paths"]
    
    await websocket.send_json({"type": "log", "msg": "Initializing CyberPlotter Core..."})
    await asyncio.sleep(0.5)
    
    await websocket.send_json({
        "type": "log", 
        "msg": f"Loaded {len(paths)} paths. Z-Down: {opt.z_down}, Z-Up: {opt.z_up}"
    })
    
    await websocket.send_json({"type": "log", "msg": "Deploying Greedy Nearest-Neighbor heuristic..."})
    
    async def progress(phase, current, total, latest_path=None):
        if phase == 1:
            if latest_path:
                pts = [{"x": p[0], "y": p[1]} for p in latest_path.points]
                await websocket.send_json({
                    "type": "progress",
                    "phase": 1,
                    "current": current,
                    "total": total,
                    "latest_path": pts
                })
                await asyncio.sleep(0.01)
        elif phase == 2:
            await websocket.send_json({"type": "log", "msg": "Phase 1 complete. Initializing 2-Opt refinement subsystem..."})
            await asyncio.sleep(0.3)
            await websocket.send_json({"type": "log", "msg": "Loading native path-inversion kernels..."})
            await asyncio.sleep(0.2)
            await websocket.send_json({"type": "log", "msg": "Executing bidirectional route optimization..."})
        elif phase == 3:
            pass  # handled below

    result = await opt.optimize(paths, progress_callback=progress)
    optimized_paths = result['paths']
    stats = result['stats']
    
    # Send Phase 2 results
    phase1_base = stats['phase1_penup_dist']
    savings_pct = 0
    if phase1_base > 0:
        savings_pct = (1 - stats['final_penup_dist'] / phase1_base) * 100
    
    await websocket.send_json({"type": "log", "msg": f"2-Opt converged: {stats['phase2_iterations']} iterations"})
    await websocket.send_json({
        "type": "log",
        "msg": (
            f"Travel: {stats['original_penup_dist']:.1f}mm (gcode) -> "
            f"{phase1_base:.1f}mm (NN) -> {stats['final_penup_dist']:.1f}mm "
            f"({savings_pct:.1f}% NN refinement)"
        )
    })
    
    paths_data = [[{"x": p[0], "y": p[1]} for p in path.points] for path in optimized_paths]
    
    # Use phase-1 baseline for 2-opt graph to avoid a misleading jump
    full_history = stats['phase2_dist_history']
    
    await websocket.send_json({
        "type": "phase2_result",
        "iterations": stats['phase2_iterations'],
        "dist_history": full_history,
        "paths": paths_data,
        "original_dist": phase1_base,
        "gcode_dist": stats['original_penup_dist'],
        "phase1_dist": phase1_base,
        "final_dist": stats['final_penup_dist'],
    })
    
    await websocket.send_json({"type": "log", "msg": "Generating optimized G-code..."})
    final_gcode = opt.generate(optimized_paths)
    job["optimized_gcode"] = final_gcode
    job["status"] = "completed"
    
    await websocket.send_json({"type": "complete", "job_id": job_id})

@app.get("/download/{job_id}")
async def download(job_id: str):
    if job_id in jobs and jobs[job_id]["optimized_gcode"]:
        return PlainTextResponse(
            jobs[job_id]["optimized_gcode"],
            headers={"Content-Disposition": f"attachment; filename=optimized_{job_id[:8]}.gcode"}
        )
    return {"error": "Job not found or not completed"}
