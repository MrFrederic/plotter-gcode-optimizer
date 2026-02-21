# PLOTTERTOOL // MFCORP UTILS

## SYSTEM OVERVIEW

Integrated toolpath optimization platform for CNC pen plotters. Converts vector graphics to machine-executable G-code with automated path reduction and overlap elimination. Real-time telemetry visualization included.

**CORE FUNCTIONS:**
- G-code sequence parsing and reordering
- SVG-to-plotter conversion pipeline
- 2-opt traveling salesman optimization
- Geometric line overlap detection and filtering
- WebSocket-driven progress monitoring

**TECH STACK:** FastAPI | Python 3.11 | Vanilla JS | Canvas API

## BUILD PROCEDURE

### STANDARD DEPLOYMENT

```bash
docker compose up -d --build
```

Service available at `http://localhost:8080`

### SUBPATH HOSTING

For reverse-proxy deployments under dedicated routes (e.g., `domain.com/plotter-tool`):

```bash
BASE_PATH=/plotter-tool docker compose up -d --build
```

Alternatively, define environment variables in `.env`:

```
BASE_PATH=/plotter-tool
```

### NGINX PROXY CONFIGURATION

```nginx
location /plotter-tool {
    proxy_pass http://localhost:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### LOCAL DEVELOPMENT

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Optional: `BASE_PATH=/plotter-tool uvicorn app.main:app --reload`

## CONFIGURATION

All operational parameters (feed rates, Z-axis control, curve tolerance, pen width filtering) are configurable via the web interface. Settings persist in browser local storage.

## DEPENDENCIES

This system incorporates [svg2gcode](https://github.com/sameer/svg2gcode) for SVG decomposition and G-code generation. Path optimization and overlap filtering are implemented internally.

---

**MFCORP INDUSTRIAL SOLUTIONS** // 2026 ALL RIGHTS RESERVED
