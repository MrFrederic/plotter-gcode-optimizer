# PLOTTERTOOL // MFCORP UTILS

**LIVE DEPLOYMENT:** https://mfihs.com/plotter-tool/

## SYSTEM OVERVIEW

Integrated toolpath optimization platform for CNC pen plotters. Converts vector graphics to machine-executable G-code with automated path reduction and overlap elimination. Real-time telemetry visualization included.

<img width="1902" height="992" alt="image" src="https://github.com/user-attachments/assets/334fd7a2-fb94-46c4-9157-04aa995044b9" />

**CORE FUNCTIONS:**
- G-code sequence parsing and reordering
- SVG-to-plotter conversion pipeline
- 2-opt traveling salesman optimization
- Geometric line overlap detection and filtering
- WebSocket-driven progress monitoring

**TECH STACK:** FastAPI | Python 3.11 | React + TypeScript + Vite | Canvas API

## BUILD PROCEDURE

### STANDARD DEPLOYMENT

```bash
docker compose up -d --build
```

Service available at `http://localhost:8080`

- Legacy UI: `http://localhost:8080/`
- React v2 UI: `http://localhost:8080/v2`

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
# Backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend (separate terminal)
cd app/frontend
npm install --legacy-peer-deps
npm run dev          # Dev server with hot-reload (proxied to backend)
npm run build        # Production build → app/frontend/dist/
npm test             # Run Vitest unit tests
```

Optional: `BASE_PATH=/plotter-tool uvicorn app.main:app --reload`

## FRONTEND ARCHITECTURE

The v2 frontend is a React + TypeScript SPA built with Vite, using a feature-sliced structure:

```
app/frontend/src/
├── api/              # Typed API client for v2 endpoints
├── store/            # Zustand state management
├── features/
│   ├── settings/     # Schema-driven settings panel (debounced, optimistic)
│   ├── path-preview/ # Canvas-based path visualization with layer toggling
│   └── upload/       # File upload, optimization trigger, download controls
├── components/       # Shared UI components (Terminal, StatusBar)
├── types.ts          # Shared TypeScript types matching backend schemas
└── __tests__/        # Unit tests (store reducers, event handling)
```

### Preview Layers

The path preview engine renders multiple visualization layers that users can toggle:

| Layer | Color | Description |
|-------|-------|-------------|
| `original` | Grey | Initial parsed paths |
| `filtered` | Red | Paths removed by pen-width filter |
| `greedy` | Blue | After nearest-neighbor sort |
| `merged` | Green | After path merging |
| `twoopt` | Yellow | After 2-opt refinement |
| `final` | White | Final optimized paths + travel moves |

## API REFERENCE

### Legacy Endpoints (v1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/upload` | Upload G-code file |
| `POST` | `/upload-svg` | Upload SVG file |
| `WS` | `/ws/{job_id}` | Optimization WebSocket |
| `GET` | `/download/{job_id}` | Download optimized G-code |

### v2 Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v2/upload` | Upload G-code (typed response) |
| `POST` | `/api/v2/upload-svg` | Upload SVG (typed response) |
| `GET` | `/api/v2/job/{job_id}` | Get job status |
| `GET` | `/api/v2/download/{job_id}` | Download optimized G-code |
| `GET` | `/api/v2/settings/schema` | Get settings JSON Schema |
| `WS` | `/api/v2/ws/{job_id}` | Optimization WebSocket (typed events) |

### WebSocket Event Types

Events sent during optimization over the v2 WebSocket:

| Event | Phase | Key Fields |
|-------|-------|------------|
| `log` | Any | `msg` |
| `filter_start` | Filter | `path_count`, `pen_width`, `visibility_threshold` |
| `filter_result` | Filter | `removed_count`, `kept_count`, `removed_indices` |
| `greedy_result` | Greedy | `paths`, `progress_history`, `original_dist`, `phase1_dist` |
| `merge_result` | Merge | `paths`, `merge_count`, `post_merge_dist` |
| `twoopt_start` | 2-OPT | `estimated_paths` |
| `phase2_result` | 2-OPT | `paths`, `iterations`, `dist_history`, `final_dist` |
| `complete` | Done | `job_id` |
| `ping` | Any | Keep-alive during long operations |
| `phase_progress` | Any | `phase`, `progress` (0–100) |

### Settings Schema

All settings are defined in `app/models.py` as a Pydantic `OptimizerSettings` model. The JSON Schema is available at `GET /api/v2/settings/schema`.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `z_up` | float | 2.0 | Pen lift height (mm) |
| `z_down` | float | 0.0 | Pen down height (mm) |
| `feedrate` | float | 1000 | Draw speed (mm/min) |
| `travel_speed` | float\|null | 3000 | Travel speed (mm/min) |
| `z_speed` | float\|null | 500 | Z-axis speed (mm/min) |
| `curve_tolerance` | float | 0.1 | SVG curve discretization (mm) |
| `pen_width` | float | 0 | Pen width for filter (0=disabled) |
| `visibility_threshold` | float | 50 | Min visibility % to keep line |
| `offset_closed_paths` | bool | false | Offset closed paths inward |
| `merge_threshold` | float | 0.5 | Max gap to merge paths (mm) |
| `gcode_header` | string | "G28" | Startup G-code commands |
| `gcode_footer` | string | "G0 Z5\nG0 X10 Y10\nM84" | Shutdown G-code commands |

## CONFIGURATION

All operational parameters are configurable via either the legacy or v2 web interface. Settings persist in browser local storage under the key `cyberplotter_settings`.

## DEPENDENCIES

This system incorporates [svg2gcode](https://github.com/sameer/svg2gcode) for SVG decomposition and G-code generation. Path optimization and overlap filtering are implemented internally.

## EXTENSION GUIDELINES

The v2 frontend is designed for future extension:

- **New settings**: Add fields to `OptimizerSettings` in `app/models.py` and `OptimizerSettings` in `src/types.ts`. The settings panel renders them automatically.
- **New preview layers**: Add a key to `PreviewLayers` in `src/types.ts` and a colour entry in `PathPreview.tsx`.
- **New WS events**: Add the event type to `WSEvent` union in `src/types.ts` and handle it in `appStore.ts` `handleWSEvent`.
- **Vectorization**: The settings panel and preview architecture support future vectorization features without refactor. Add vectorization-specific settings and preview layers when ready.

## DISCLAIMER

This application was shamelessly vibe-coded by an individual whose close-to-zero coding skills are a source of deep, profound shame. The code quality reflects this unfortunate reality. Proceed with appropriate caution.

---

**MFCORP INDUSTRIAL SOLUTIONS** // 2026 ALL RIGHTS RESERVED
