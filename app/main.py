from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.routers import gcode, svg as svg_router

app = FastAPI()

app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.include_router(gcode.router)
app.include_router(svg_router.router)


@app.get("/")
async def get():
    with open("app/static/index.html") as f:
        return HTMLResponse(f.read())
