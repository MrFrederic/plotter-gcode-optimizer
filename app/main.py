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
    
    await websocket.send_json({"type": "log", "msg": "Starting Neural Optimization Routing..."})
    
    async def progress(current, total, latest_path, merged_count=0):
        if latest_path:
            pts = [{"x": p[0], "y": p[1]} for p in latest_path.points]
            await websocket.send_json({
                "type": "progress",
                "current": current,
                "total": total,
                "latest_path": pts
            })
            await asyncio.sleep(0.01) # Artificial delay for cool visualization
        if merged_count > 0:
            await websocket.send_json({
                "type": "log",
                "msg": f"Optimization complete. Merged {merged_count} paths."
            })

    optimized_paths = await opt.optimize(paths, progress_callback=progress)
    
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
