/**
 * two_opt.c — High-performance 2-Opt path optimizer for pen plotter toolpaths.
 * Compiled as shared library and loaded via ctypes from Python.
 *
 * Build: gcc -O3 -shared -fPIC -o two_opt.so two_opt.c -lm
 */

#include <math.h>

static inline double pdist(double x1, double y1, double x2, double y2) {
    double dx = x1 - x2, dy = y1 - y2;
    return sqrt(dx * dx + dy * dy);
}

static inline void dswap(double *a, double *b) {
    double t = *a; *a = *b; *b = t;
}

static inline void iswap(int *a, int *b) {
    int t = *a; *a = *b; *b = t;
}

static double total_penup(const double *sx, const double *sy,
                          const double *ex, const double *ey, int n) {
    if (n == 0) return 0.0;
    double t = pdist(0.0, 0.0, sx[0], sy[0]);
    for (int i = 0; i < n - 1; i++)
        t += pdist(ex[i], ey[i], sx[i + 1], sy[i + 1]);
    return t;
}

/**
 * Run 2-opt optimization on an array of line segments.
 *
 * Parameters (all arrays have length n):
 *   n          — number of segments
 *   sx, sy     — start point coordinates (modified in place)
 *   ex, ey     — end point coordinates (modified in place)
 *   order      — original indices, initially [0..n-1] (modified in place)
 *   flipped    — flip flags, initially all 0 (modified in place)
 *   max_iter   — maximum number of 2-opt passes
 *   hist       — output distance history, must hold (max_iter + 1) doubles
 *
 * Returns: number of iterations actually performed.
 */
int two_opt(int n,
            double *sx, double *sy,
            double *ex, double *ey,
            int *order, int *flipped,
            int max_iter, double *hist) {

    hist[0] = total_penup(sx, sy, ex, ey, n);
    if (n <= 1) return 0;

    int iter = 0, improved = 1;

    while (improved && iter < max_iter) {
        improved = 0;
        iter++;

        for (int i = 0; i < n - 1; i++) {
            double px = (i > 0) ? ex[i - 1] : 0.0;
            double py = (i > 0) ? ey[i - 1] : 0.0;

            for (int j = i + 1; j < n; j++) {
                double cur = pdist(px, py, sx[i], sy[i]);
                double nw  = pdist(px, py, ex[j], ey[j]);

                if (j < n - 1) {
                    cur += pdist(ex[j], ey[j], sx[j + 1], sy[j + 1]);
                    nw  += pdist(sx[i], sy[i], sx[j + 1], sy[j + 1]);
                }

                if (nw < cur - 1e-6) {
                    /* Reverse sub-sequence [i..j] and flip each segment */
                    int l = i, r = j;
                    while (l < r) {
                        dswap(&sx[l], &sx[r]); dswap(&sy[l], &sy[r]);
                        dswap(&ex[l], &ex[r]); dswap(&ey[l], &ey[r]);
                        iswap(&order[l], &order[r]);
                        iswap(&flipped[l], &flipped[r]);

                        /* flip drawing direction for both ends */
                        dswap(&sx[l], &ex[l]); dswap(&sy[l], &ey[l]);
                        flipped[l] ^= 1;
                        dswap(&sx[r], &ex[r]); dswap(&sy[r], &ey[r]);
                        flipped[r] ^= 1;

                        l++; r--;
                    }
                    if (l == r) {
                        dswap(&sx[l], &ex[l]);
                        dswap(&sy[l], &ey[l]);
                        flipped[l] ^= 1;
                    }

                    improved = 1;
                    break;
                }
            }
            if (improved) break;
        }

        hist[iter] = total_penup(sx, sy, ex, ey, n);
    }

    return iter;
}
