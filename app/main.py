import os
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from app.routers import gcode, svg as svg_router
from app.routers import gcode_v2

BASE_PATH = os.getenv("BASE_PATH", "").rstrip("/")

app = FastAPI(root_path=BASE_PATH)

if BASE_PATH:
    class StripBasePath:
        def __init__(self, app):
            self.app = app

        async def __call__(self, scope, receive, send):
            if scope["type"] in ("http", "websocket"):
                path = scope.get("path", "")
                if path.startswith(BASE_PATH):
                    scope["path"] = path[len(BASE_PATH):] or "/"
                    scope["raw_path"] = scope["path"].encode()
            await self.app(scope, receive, send)

    app.add_middleware(StripBasePath)

# Legacy static files (index.html, script.js, style.css)
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Legacy v1 routes (preserved for backward compatibility)
app.include_router(gcode.router)
app.include_router(svg_router.router)

# Versioned v2 API routes
app.include_router(gcode_v2.router)

# Serve React SPA from app/frontend/dist if the build exists
_frontend_dist = os.path.join(os.path.dirname(__file__), "frontend", "dist")
_frontend_available = os.path.isdir(_frontend_dist)

if _frontend_available:
    app.mount("/app-assets", StaticFiles(directory=_frontend_dist), name="frontend-assets")


@app.get("/v2")
async def get_v2():
    """Serve the React SPA entry point."""
    index_path = os.path.join(_frontend_dist, "index.html")
    if _frontend_available and os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse(
        "<h1>Frontend not built</h1><p>Run <code>npm run build</code> in <code>app/frontend</code> first.</p>",
        status_code=503,
    )


@app.get("/")
async def get():
    with open("app/static/index.html") as f:
        return HTMLResponse(f.read())