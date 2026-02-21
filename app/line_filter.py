"""
Pen-width line filtering — removes paths whose drawn area
is mostly covered by other (longer) paths, given a real pen
width and a minimum-visibility threshold.

Algorithm
---------
1. Sort paths by drawing length (longest first — they get priority).
2. Build a spatial segment-index incrementally as paths are kept.
3. For each path (long → short) sample equidistant points along it
   and measure how much of the pen mark at each sample is already
   covered by segments of previously-kept paths.
4. If the mean visibility (1 − coverage) falls below the threshold
   the path is discarded.

Coverage model (linear, for two equal-width pen strokes):
    coverage(d) = max(0, 1 − d / pen_width)
where *d* is the distance from the sample point to the nearest
indexed segment centre-line.  At d=0 the strokes fully overlap;
at d≥pen_width they don't overlap at all.
"""

import math


# ── helpers ──────────────────────────────────────────────────────────────────


def _pt_seg_dist_sq(px, py, ax, ay, bx, by):
    """Squared distance from point (px, py) to line-segment (a → b)."""
    dx, dy = bx - ax, by - ay
    len_sq = dx * dx + dy * dy
    if len_sq < 1e-24:                       # degenerate (zero-length) segment
        ex, ey = px - ax, py - ay
        return ex * ex + ey * ey
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len_sq))
    ex = px - (ax + t * dx)
    ey = py - (ay + t * dy)
    return ex * ex + ey * ey


def _sample_path(points, interval):
    """
    Evenly-spaced samples along a polyline.
    Always includes the first and last points.
    """
    if not points:
        return []
    if len(points) == 1:
        return [points[0]]

    samples = [points[0]]
    residual = 0.0

    for i in range(len(points) - 1):
        x0, y0 = points[i]
        x1, y1 = points[i + 1]
        seg_len = math.hypot(x1 - x0, y1 - y0)
        if seg_len < 1e-12:
            continue
        ux, uy = (x1 - x0) / seg_len, (y1 - y0) / seg_len
        pos = interval - residual

        while pos < seg_len - 1e-12:
            samples.append((x0 + ux * pos, y0 + uy * pos))
            pos += interval

        residual = seg_len - (pos - interval)

    last = points[-1]
    if math.hypot(samples[-1][0] - last[0], samples[-1][1] - last[1]) > 1e-12:
        samples.append(last)

    return samples


# ── spatial hash grid ────────────────────────────────────────────────────────


class _SegGrid:
    """Hash-grid storing line-segment references for proximity queries."""

    __slots__ = ("cs", "inv", "g")

    def __init__(self, cell_size):
        self.cs = cell_size
        self.inv = 1.0 / cell_size
        self.g = {}                          # (cx, cy) → [(ax,ay,bx,by), …]

    def add_segments(self, points):
        """Insert every consecutive segment of *points* into the grid."""
        inv = self.inv
        g = self.g
        for i in range(len(points) - 1):
            ax, ay = points[i]
            bx, by = points[i + 1]
            seg = (ax, ay, bx, by)
            c0x = int(math.floor(min(ax, bx) * inv))
            c1x = int(math.floor(max(ax, bx) * inv))
            c0y = int(math.floor(min(ay, by) * inv))
            c1y = int(math.floor(max(ay, by) * inv))
            for cx in range(c0x, c1x + 1):
                for cy in range(c0y, c1y + 1):
                    key = (cx, cy)
                    if key in g:
                        g[key].append(seg)
                    else:
                        g[key] = [seg]

    def max_coverage_at(self, px, py, pw, pw_sq):
        """
        Maximum coverage fraction [0‥1] at (*px*, *py*) from any
        indexed segment, using the linear overlap model.
        """
        inv = self.inv
        g = self.g
        r = int(math.ceil(pw * inv))
        cx0 = int(math.floor(px * inv))
        cy0 = int(math.floor(py * inv))

        best = 0.0
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                bucket = g.get((cx0 + dx, cy0 + dy))
                if bucket is None:
                    continue
                for seg in bucket:
                    dsq = _pt_seg_dist_sq(px, py,
                                          seg[0], seg[1], seg[2], seg[3])
                    if dsq >= pw_sq:
                        continue
                    cov = 1.0 - math.sqrt(dsq) / pw
                    if cov > best:
                        best = cov
                        if best >= 0.999:
                            return 1.0
        return best


# ── core filter ──────────────────────────────────────────────────────────────


def filter_covered_paths(paths, pen_width, visibility_threshold):
    """
    Remove paths whose drawn area is mostly covered by other paths.

    Parameters
    ----------
    paths : list[Path]
        Each Path has a ``.points`` attribute (list of (x, y) tuples).
    pen_width : float
        Pen-tip diameter in mm.  Must be > 0 for filtering to act.
    visibility_threshold : float
        Fraction in [0, 1].  Paths with average visibility below this
        value are removed.

    Returns
    -------
    (filtered_paths: list[Path], removed_indices: list[int])
    """
    # Guard: nothing to filter
    if (not paths
            or pen_width <= 0
            or visibility_threshold <= 0
            or len(paths) < 2):
        return list(paths), []

    pw = float(pen_width)
    pw_sq = pw * pw
    sample_iv = pw / 2.0                     # sample every half-pen-width
    cell = max(pw, 1.0)                      # grid cell ≥ 1 mm

    # ── path lengths (for priority) ──────────────────────────────
    indexed = []
    for i, p in enumerate(paths):
        pts = p.points
        length = 0.0
        for j in range(len(pts) - 1):
            length += math.hypot(pts[j + 1][0] - pts[j][0],
                                 pts[j + 1][1] - pts[j][1])
        indexed.append((i, p, length))

    indexed.sort(key=lambda x: -x[2])        # longest first

    grid = _SegGrid(cell)
    kept = []                                 # (original_index, path)
    removed_indices = []                      # original indices of removed paths

    for orig_i, path, length in indexed:
        pts = path.points

        # The very first path is always kept (nothing to compare against)
        if not kept:
            grid.add_segments(pts)
            kept.append((orig_i, path))
            continue

        # sample points along the path
        if length > 1e-12:
            samples = _sample_path(pts, sample_iv)
        else:
            # zero-length path (all points coincident): single sample
            samples = [pts[0]]

        # aggregate visibility over all samples
        vis_sum = 0.0
        for sx, sy in samples:
            cov = grid.max_coverage_at(sx, sy, pw, pw_sq)
            vis_sum += 1.0 - cov

        avg_vis = vis_sum / len(samples)

        if avg_vis >= visibility_threshold:
            grid.add_segments(pts)
            kept.append((orig_i, path))
        else:
            removed_indices.append(orig_i)

    # restore original ordering
    kept.sort(key=lambda x: x[0])
    return [p for _, p in kept], removed_indices


# ── convenience wrapper used by routers ──────────────────────────────────────


def apply_pen_filter(paths, settings):
    """
    Read *pen_width* and *visibility_threshold* from user settings,
    run filtering when pen_width > 0.

    Returns
    -------
    (paths, filter_stats_or_None)
    """
    pw = float(settings.get("pen_width", 0))
    vt = float(settings.get("visibility_threshold", 50))     # percentage

    if pw <= 0:
        return paths, None

    original_count = len(paths)
    filtered, removed_indices = filter_covered_paths(paths, pw, vt / 100.0)

    stats = {
        "original_count": original_count,
        "removed_count": len(removed_indices),
        "removed_indices": removed_indices,
        "pen_width": pw,
        "visibility_threshold": vt,
    }
    return filtered, stats
