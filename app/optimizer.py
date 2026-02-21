import math
import re
import ctypes
import os
import subprocess

def dist(p1, p2):
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])

# --- Native 2-opt library (compiled from C) ---
_two_opt_lib = None

def _get_two_opt_lib():
    global _two_opt_lib
    if _two_opt_lib is not None:
        return _two_opt_lib

    base = os.path.dirname(os.path.abspath(__file__))
    c_file = os.path.join(base, 'two_opt.c')
    so_file = os.path.join(base, 'two_opt.so')

    need_compile = (
        not os.path.exists(so_file)
        or os.path.getmtime(c_file) > os.path.getmtime(so_file)
    )
    if need_compile:
        subprocess.run(
            ['gcc', '-O3', '-shared', '-fPIC', '-o', so_file, c_file, '-lm'],
            check=True
        )

    lib = ctypes.CDLL(so_file)
    lib.two_opt.restype = ctypes.c_int
    lib.two_opt.argtypes = [
        ctypes.c_int,
        ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_double),
        ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_double),
        ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
        ctypes.c_int,
        ctypes.POINTER(ctypes.c_double),
    ]
    _two_opt_lib = lib
    return lib

class Path:
    def __init__(self, points):
        self.points = points

    @property
    def start(self): return self.points[0]
    @property
    def end(self): return self.points[-1]
    def reverse(self): self.points.reverse()

class GcodeOptimizer:
    def __init__(self):
        self.z_up = 2.0
        self.z_down = 0.0
        self.feedrate = 1000
        self.travel_speed = 3000
        self.z_speed = 500
        self.max_iterations = 500
        self.gcode_header = "G28"
        self.gcode_footer = "G0 Z5\nG0 X10 Y10\nM84"
        self.preamble = []
        self.postamble = []

    def parse(self, gcode_text):
        paths = []
        current_path = []
        is_drawing = False
        current_x, current_y = 0.0, 0.0
        
        lines = gcode_text.split('\n')
        
        # Try to find Z up/down values
        z_values = set()
        for line in lines:
            clean = line.split(';')[0].strip()
            if 'Z' in clean and ('G0' in clean or 'G1' in clean):
                match = re.search(r'Z(-?\d+\.?\d*)', clean)
                if match:
                    z_values.add(float(match.group(1)))
        
        if len(z_values) >= 2:
            sorted_z = sorted(list(z_values))
            self.z_down = sorted_z[0]
            self.z_up = sorted_z[-1]

        for line in lines:
            clean_line = line.split(';')[0].strip()
            if not clean_line:
                continue
                
            parts = clean_line.split()
            cmd = parts[0].upper()
            
            x, y, z, f = None, None, None, None
            for part in parts[1:]:
                if part.startswith('X'): x = float(part[1:])
                elif part.startswith('Y'): y = float(part[1:])
                elif part.startswith('Z'): z = float(part[1:])
                elif part.startswith('F'): f = float(part[1:])
                
            if f is not None: self.feedrate = f
            if x is not None: current_x = x
            if y is not None: current_y = y
            
            if cmd in ('G0', 'G1'):
                if z is not None:
                    if z <= (self.z_down + 0.1): # Pen down
                        is_drawing = True
                        current_path = [(current_x, current_y)]
                    else: # Pen up
                        if is_drawing:
                            is_drawing = False
                            if len(current_path) > 1:
                                paths.append(Path(current_path))
                            current_path = []
                else:
                    if is_drawing:
                        current_path.append((current_x, current_y))
        
        if is_drawing and len(current_path) > 1:
            paths.append(Path(current_path))
            
        return paths

    def calculate_penup_distance(self, paths):
        if not paths: return 0.0
        dist_total = dist((0.0, 0.0), paths[0].start)
        for i in range(len(paths) - 1):
            dist_total += dist(paths[i].end, paths[i+1].start)
        return dist_total

    async def optimize(self, paths, merge_threshold=0.05, progress_callback=None):
        if not paths:
            return {
                'paths': [],
                'stats': {
                    'original_penup_dist': 0,
                    'phase1_penup_dist': 0,
                    'final_penup_dist': 0,
                    'phase2_iterations': 0,
                    'phase2_dist_history': [0],
                }
            }
        
        # Calculate original (unoptimized) pen-up distance
        original_dist = self.calculate_penup_distance(paths)
        
        unvisited = paths.copy()
        optimized = []
        current_pos = (0.0, 0.0)
        total = len(paths)
        
        # Pre-calculate lengths for heuristic
        for p in unvisited:
            p.length = sum(dist(p.points[i], p.points[i+1]) for i in range(len(p.points)-1))
        
        # Phase 1: Greedy Nearest Neighbor
        if progress_callback:
            await progress_callback(phase=1, current=0, total=total)
            
        while unvisited:
            best_path = None
            best_score = float('inf')
            reverse_best = False
            
            for p in unvisited:
                d_start = dist(current_pos, p.start)
                d_end = dist(current_pos, p.end)
                
                score_start = d_start + (p.length * 0.1)
                score_end = d_end + (p.length * 0.1)
                
                if score_start < best_score:
                    best_score = score_start
                    best_path = p
                    reverse_best = False
                if score_end < best_score:
                    best_score = score_end
                    best_path = p
                    reverse_best = True
                    
            if reverse_best:
                best_path.reverse()
                
            optimized.append(best_path)
            current_pos = best_path.end
            unvisited.remove(best_path)
            
            if progress_callback and len(optimized) % max(1, total // 100) == 0:
                await progress_callback(phase=1, current=len(optimized), total=total, latest_path=best_path)
        
        phase1_dist = self.calculate_penup_distance(optimized)

        # Phase 2: 2-Opt Refinement (native C)
        if progress_callback:
            await progress_callback(phase=2, current=0, total=0)

        n = len(optimized)
        max_iterations = self.max_iterations

        lib = _get_two_opt_lib()

        c_double_n = ctypes.c_double * n
        c_int_n = ctypes.c_int * n
        c_double_hist = ctypes.c_double * (max_iterations + 1)

        sx = c_double_n(*[p.start[0] for p in optimized])
        sy = c_double_n(*[p.start[1] for p in optimized])
        ex = c_double_n(*[p.end[0] for p in optimized])
        ey = c_double_n(*[p.end[1] for p in optimized])
        order = c_int_n(*range(n))
        flipped = c_int_n(*([0] * n))
        hist = c_double_hist()

        iterations = lib.two_opt(n, sx, sy, ex, ey, order, flipped, max_iterations, hist)

        # Reconstruct the optimized path list from C results
        original_paths = optimized[:]
        optimized = []
        for i in range(n):
            p = Path(list(original_paths[order[i]].points))
            if flipped[i]:
                p.reverse()
            optimized.append(p)

        dist_history = [hist[i] for i in range(iterations + 1)]
        final_dist = dist_history[-1]

        if progress_callback:
            await progress_callback(phase=3, current=total, total=total)
            
        return {
            'paths': optimized,
            'stats': {
                'original_penup_dist': original_dist,
                'phase1_penup_dist': phase1_dist,
                'final_penup_dist': final_dist,
                'phase2_iterations': iterations,
                'phase2_dist_history': dist_history,
            }
        }

    def generate(self, paths):
        out = []
        out.append("; Optimized by CyberPlotter")
        out.append("G90 ; Absolute positioning")
        out.append("G21 ; Millimeters")
        if self.gcode_header:
            for line in self.gcode_header.splitlines():
                if line.strip():
                    out.append(line.strip())
        out.append(f"G0 Z{self.z_up:.2f} F{self.z_speed:.0f} ; Pen up (controlled Z speed)")

        for p in paths:
            start = p.start
            out.append(f"G0 X{start[0]:.3f} Y{start[1]:.3f} F{self.travel_speed:.0f}")
            out.append(f"G0 Z{self.z_down:.2f} F{self.z_speed:.0f}")
            for pt in p.points[1:]:
                out.append(f"G1 X{pt[0]:.3f} Y{pt[1]:.3f} F{self.feedrate:.0f}")
            out.append(f"G0 Z{self.z_up:.2f} F{self.z_speed:.0f}")

        if self.gcode_footer:
            for line in self.gcode_footer.splitlines():
                if line.strip():
                    out.append(line.strip())
        return "\n".join(out)
