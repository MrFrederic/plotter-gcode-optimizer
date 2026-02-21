import math
import re

def dist(p1, p2):
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])

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

    async def optimize(self, paths, merge_threshold=0.05, progress_callback=None):
        if not paths: return []
        
        unvisited = paths.copy()
        optimized = []
        current_pos = (0.0, 0.0)
        total = len(paths)
        
        # Pre-calculate bounding boxes and centers for clustering
        for p in unvisited:
            xs = [pt[0] for pt in p.points]
            ys = [pt[1] for pt in p.points]
            p.center = (sum(xs)/len(xs), sum(ys)/len(ys))
            p.length = sum(dist(p.points[i], p.points[i+1]) for i in range(len(p.points)-1))
        
        while unvisited:
            best_path = None
            best_score = float('inf')
            reverse_best = False
            
            for p in unvisited:
                d_start = dist(current_pos, p.start)
                d_end = dist(current_pos, p.end)
                
                # Score is based on distance to start/end, but we penalize leaving dense areas
                # We estimate density by checking distance to the center of the path
                # A path that is close to our current position AND close to other paths is better
                
                # Simple heuristic: distance + a small penalty for long paths to prefer clearing out small details first
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
                await progress_callback(len(optimized), total, best_path)
                
        # Merge step
        merged = []
        if optimized:
            current_merged = Path(list(optimized[0].points))
            for i in range(1, len(optimized)):
                next_path = optimized[i]
                if dist(current_merged.end, next_path.start) <= merge_threshold:
                    current_merged.points.extend(next_path.points[1:])
                else:
                    merged.append(current_merged)
                    current_merged = Path(list(next_path.points))
            merged.append(current_merged)
            
        if progress_callback:
            await progress_callback(total, total, None, merged_count=total - len(merged))
            
        return merged

    def generate(self, paths):
        out = []
        out.append("; Optimized by CyberPlotter")
        out.append("G90 ; Absolute positioning")
        out.append("G21 ; Millimeters")
        out.append(f"G0 Z{self.z_up:.2f} ; Pen up")
        
        for p in paths:
            start = p.start
            out.append(f"G0 X{start[0]:.3f} Y{start[1]:.3f}")
            out.append(f"G0 Z{self.z_down:.2f}")
            for pt in p.points[1:]:
                out.append(f"G1 X{pt[0]:.3f} Y{pt[1]:.3f} F{self.feedrate}")
            out.append(f"G0 Z{self.z_up:.2f}")
            
        out.append("G0 X0 Y0 ; Return to home")
        return "\n".join(out)
