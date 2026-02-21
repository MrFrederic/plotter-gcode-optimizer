import os
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.routers import gcode, svg as svg_router

BASE_PATH = os.getenv("BASE_PATH", "").rstrip("/")

app = FastAPI(root_path=BASE_PATH)

if BASE_PATH:
    class StripBasePath(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            path = request.scope.get("path", "")
            if path.startswith(BASE_PATH):
                request.scope["path"] = path[len(BASE_PATH):] or "/"
                request.scope["raw_path"] = request.scope["path"].encode()
            return await call_next(request)
    app.add_middleware(StripBasePath)

app.mount("/static", StaticFiles(directory="app/static"), name="static")
app.include_router(gcode.router)
app.include_router(svg_router.router)

@app.get("/")
async def get():
    with open("app/static/index.html") as f:
        return HTMLResponse(f.read())