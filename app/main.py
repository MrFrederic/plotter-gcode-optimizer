import os
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.routers import gcode, svg as svg_router

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

app.mount("/static", StaticFiles(directory="app/static"), name="static")
app.include_router(gcode.router)
app.include_router(svg_router.router)

@app.get("/")
async def get():
    with open("app/static/index.html") as f:
        return HTMLResponse(f.read())