// ─── Shared application state ─────────────────────────────────────────────────
// All modules read/write this shared state object instead of using globals.

export const state = {
    currentJobId: null,
    originalPaths: [],
    optimizedPaths: [],
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    distHistory: [],
    currentPhase: 0,

    // Graph animation
    graphAnimating: false,
    animationToken: 0,
    pendingComplete: null,

    // File / SVG
    pendingSvgFile: null,
    svgObjectUrl: null,

    // Line filter
    removedPaths: [],
    removedPathsInCorner: false,
    filterAnimStart: null,

    // Greedy animation
    greedyAnimating: false,
    greedyAnimToken: 0,
    greedyHistory: [],
    greedyOriginalDist: 0,
    greedyPhase1Dist: 0,

    // Local scan (filter preview)
    localScanActive: false,
    localScanToken: 0,
    localScanIndices: [],

    // Fake burn-down chart
    fakeBurndownActive: false,
    fakeBurndownData: [],
    fakeBurndownStartTime: null,
    fakeBurndownToken: 0,
    fakeBurndownDrawTime: 0,
    fakeBurndownTravelSpeed: 1,
    fakeBurndownOrigTotalTime: 0,

    // 2-OPT state
    twoOptCompleted: false,
    pendingTwoOptResult: null,
    twoOptStartDist: 0,

    // UI flags
    isComparing: false,
    filterScanning: false,
    scanningPaths: [],
};
