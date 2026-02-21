import ctypes
import sys
sys.path.insert(0, '/app')
from app.optimizer import _get_two_opt_lib

lib = _get_two_opt_lib()

n = 4
sx = (ctypes.c_double * n)(10, 0, 20, 5)
sy = (ctypes.c_double * n)(10, 0, 20, 5)
ex = (ctypes.c_double * n)(11, 1, 21, 6)
ey = (ctypes.c_double * n)(11, 1, 21, 6)
order = (ctypes.c_int * n)(0, 1, 2, 3)
flipped = (ctypes.c_int * n)(0, 0, 0, 0)
hist = (ctypes.c_double * 501)()

iters = lib.two_opt(n, sx, sy, ex, ey, order, flipped, 500, hist)
print(f"Iterations: {iters}")
print(f"Initial dist: {hist[0]:.2f}")
print(f"Final dist:   {hist[iters]:.2f}")
print(f"Order: {list(order)}")
print(f"Flipped: {list(flipped)}")
print("TEST PASSED")
