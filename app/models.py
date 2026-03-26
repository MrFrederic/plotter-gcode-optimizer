"""Typed request/response/event schemas for the v2 API."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


# ── Settings schema ──────────────────────────────────────────────────────────


class OptimizerSettings(BaseModel):
    z_up: float = Field(2.0, description="Pen lift height in mm")
    z_down: float = Field(0.0, description="Pen down height in mm")
    feedrate: float = Field(1000, description="Draw speed in mm/min")
    travel_speed: Optional[float] = Field(3000, description="Travel speed in mm/min")
    z_speed: Optional[float] = Field(500, description="Z-axis speed in mm/min")
    curve_tolerance: float = Field(0.1, description="SVG curve discretization tolerance in mm")
    pen_width: float = Field(0, description="Pen width in mm (0 to disable filter)")
    visibility_threshold: float = Field(50, description="Min visibility % to keep a line")
    offset_closed_paths: bool = Field(False, description="Offset closed paths inward by pen_width/2")
    merge_threshold: float = Field(0.5, description="Max gap to merge adjacent paths in mm")
    gcode_header: str = Field("G28", description="G-code header commands")
    gcode_footer: str = Field("G0 Z5\nG0 X10 Y10\nM84", description="G-code footer commands")


# ── Response schemas ─────────────────────────────────────────────────────────


class Point(BaseModel):
    x: float
    y: float


class UploadResponse(BaseModel):
    job_id: str
    paths: List[List[Point]]
    source: str = "gcode"
    path_count: int
    settings: OptimizerSettings


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    path_count: int
    settings: OptimizerSettings


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None


# ── WebSocket event schemas ──────────────────────────────────────────────────


class WSLogEvent(BaseModel):
    type: str = "log"
    msg: str


class WSFilterStartEvent(BaseModel):
    type: str = "filter_start"
    path_count: int
    pen_width: float
    visibility_threshold: float


class WSFilterResultEvent(BaseModel):
    type: str = "filter_result"
    original_count: int
    removed_count: int
    kept_count: int
    removed_indices: List[int]
    pen_width: float
    visibility_threshold: float


class WSGreedyResultEvent(BaseModel):
    type: str = "greedy_result"
    paths: List[List[Point]]
    progress_history: list
    original_dist: float
    phase1_dist: float
    path_count: int


class WSMergeResultEvent(BaseModel):
    type: str = "merge_result"
    paths: List[List[Point]]
    original_count: int
    merged_count: int
    merge_count: int
    post_merge_dist: float


class WSTwoOptStartEvent(BaseModel):
    type: str = "twoopt_start"
    estimated_paths: int


class WSPhase2ResultEvent(BaseModel):
    type: str = "phase2_result"
    iterations: int
    dist_history: list
    paths: List[List[Point]]
    original_dist: float
    gcode_dist: float
    phase1_dist: float
    final_dist: float


class WSCompleteEvent(BaseModel):
    type: str = "complete"
    job_id: str


class WSPingEvent(BaseModel):
    type: str = "ping"


class WSPhaseProgressEvent(BaseModel):
    """Incremental progress event for long-running phases."""

    type: str = "phase_progress"
    phase: str
    progress: float = Field(description="0-100 progress percentage")
    detail: Optional[str] = None
