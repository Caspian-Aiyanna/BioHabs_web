// RSF Comparison JavaScript - 9 Panel Layout with L.imageOverlay
// Plasma heatmap · Layer toggles · Zoom-locked to study area

// ============================================================================
// GLOBAL STATE
// ============================================================================
let currentBehavior = 'Foraging';
let currentMapType  = 'Realized';

// Layer visibility (shared across all maps)
const layerState = {
    rsf:       true,
    studyArea: true,
    homeRange: true,
    fence:     true,
};

const MAP_CONFIGS = [
    { id: 'e3-pre',  elephant: 'E3', period: 'pre'  },
    { id: 'e3-post', elephant: 'E3', period: 'post' },
    { id: 'e4-pre',  elephant: 'E4', period: 'pre'  },
    { id: 'e4-post', elephant: 'E4', period: 'post' },
    { id: 'e5-pre',  elephant: 'E5', period: 'pre'  },
    { id: 'e5-post', elephant: 'E5', period: 'post' },
    { id: 'e1-pre',  elephant: 'E1', period: 'pre'  },
    { id: 'e2-pre',  elephant: 'E2', period: 'pre'  },
    { id: 'e6-pre',  elephant: 'E6', period: 'pre'  },
];

let maps         = {};
let imageOverlays = {};
let rsfBounds    = null;

// Shared boundary layer references (per map)
const studyAreaLayers  = {};
const homeRangeLayers  = {};
const fenceLayers      = {};

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    showLoading(true);

    // Fetch bounds JSON
    try {
        const response = await fetch('data/rsf_bounds.json');
        if (!response.ok) throw new Error('Failed to load bounds');
        rsfBounds = await response.json();
    } catch (err) {
        console.error("Error loading RSF bounds:", err);
    }

    // Fetch elephant stats JSON
    try {
        const statsRes = await fetch('data/elephant_stats.json');
        if (statsRes.ok) {
            const statsData = await statsRes.json();
            renderElephantStats(statsData);
        }
    } catch (err) {
        console.error("Error loading elephant stats:", err);
    }

    initializeMaps();
    initializeEventListeners();
    await loadSharedBoundaries();
    updateOverlays();

    showLoading(false);
});

function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (show) { overlay.classList.add('active'); }
    else       { overlay.classList.remove('active'); }
}

// ============================================================================
// MAP SETUP
// ============================================================================
function initializeMaps() {
    // Study area bounds (Kariega) — used as default view
    const studyBounds = L.latLngBounds(
        L.latLng(-33.647207450452385, 26.490329581872157),
        L.latLng(-33.55575895452902,  26.611781808285116)
    );

    MAP_CONFIGS.forEach(config => {
        const containerId = `map-${config.id}`;
        const map = L.map(containerId, {
            preferCanvas: true,
            zoomControl: false,
            minZoom: 4,          // Africa-level zoom out max
            maxZoom: 18,
        });

        // Fit to study area on load
        map.fitBounds(studyBounds, { padding: [10, 10] });

        // Add zoom control to top-right
        L.control.zoom({ position: 'topright' }).addTo(map);

        // Satellite basemap
        L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            { attribution: '© Esri', maxZoom: 18, minZoom: 4, crossOrigin: true }
        ).addTo(map);

        // Plasma gradient legend (inside map pane → stays with map while scrolling)
        const legendControl = L.control({ position: 'bottomright' });
        legendControl.onAdd = function () {
            const div = L.DomUtil.create('div', 'map-legend-control');
            div.innerHTML = `
                <div style="background:rgba(0,0,0,0.70);padding:6px 12px;border-radius:6px;
                            backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,0.15);
                            margin-bottom:10px;margin-right:10px;">
                    <div style="font-size:0.65rem;color:#eee;text-align:center;
                                margin-bottom:4px;font-weight:500;">Selection Intensity</div>
                    <div class="rsf-gradient" style="height:6px;width:120px;
                                border-radius:3px;margin-bottom:3px;"></div>
                    <div style="display:flex;justify-content:space-between;
                                font-size:0.6rem;color:#ccc;">
                        <span>Low</span><span>High</span>
                    </div>
                </div>`;
            return div;
        };
        legendControl.addTo(map);

        maps[config.id] = map;
    });

    // Synchronize panning/zoom across all 9 maps
    const mapIds = Object.keys(maps);
    for (let i = 0; i < mapIds.length; i++) {
        for (let j = 0; j < mapIds.length; j++) {
            if (i !== j) maps[mapIds[i]].sync(maps[mapIds[j]]);
        }
    }
}

// ============================================================================
// SHARED BOUNDARY LAYERS
// ============================================================================
async function loadSharedBoundaries() {
    const homeRangeStyle = { color: '#ffffff', weight: 2,   fillOpacity: 0,    dashArray: '5, 5' };
    const studyAreaStyle = { color: '#FFD700', weight: 2.5, fillOpacity: 0.05, fillColor: '#FFD700', dashArray: '8, 4' };
    const fenceStyle     = { color: '#FF4444', weight: 2,   fillOpacity: 0,    dashArray: '4, 4' };

    try {
        const [kwRes, hvRes, studyRes, fenceRes] = await Promise.all([
            fetch('data/kw_boundary.geojson').then(r => r.json()),
            fetch('data/hv_boundary.geojson').then(r => r.json()),
            fetch('data/study_area_boundary.geojson').then(r => r.json()),
            fetch('data/fence_2024.geojson').then(r => r.json()),
        ]);

        MAP_CONFIGS.forEach(config => {
            const map = maps[config.id];
            if (!map) return;

            // Study area on ALL maps
            const saLayer = L.geoJSON(studyRes, { style: studyAreaStyle });
            if (layerState.studyArea) saLayer.addTo(map);
            studyAreaLayers[config.id] = saLayer;

            // Home-range boundary & fence only on PRE maps
            if (config.period === 'pre') {
                const hrGeo = (config.elephant === 'E5' || config.elephant === 'E6') ? hvRes : kwRes;
                const hrLayer = L.geoJSON(hrGeo, { style: homeRangeStyle });
                if (layerState.homeRange) hrLayer.addTo(map);
                homeRangeLayers[config.id] = hrLayer;

                const fLayer = L.geoJSON(fenceRes, { style: fenceStyle });
                if (layerState.fence) fLayer.addTo(map);
                fenceLayers[config.id] = fLayer;
            }
        });
    } catch (err) {
        console.error("Error loading boundaries:", err);
    }
}

// Toggle a named layer group on/off across all maps
function toggleLayerGroup(groupObj, visible) {
    MAP_CONFIGS.forEach(config => {
        const layer = groupObj[config.id];
        if (!layer) return;
        const map = maps[config.id];
        if (visible) {
            if (!map.hasLayer(layer)) layer.addTo(map);
        } else {
            if (map.hasLayer(layer)) map.removeLayer(layer);
        }
    });
}

// ============================================================================
// UPDATE OVERLAYS (RSF images)
// ============================================================================
function updateOverlays() {
    if (!rsfBounds) return;

    MAP_CONFIGS.forEach(config => {
        const map = maps[config.id];
        if (!map) return;

        // Remove old overlay
        if (imageOverlays[config.id]) {
            map.removeLayer(imageOverlays[config.id]);
            imageOverlays[config.id] = null;
        }

        if (!layerState.rsf) return;

        const boundsKey = `${currentMapType}_${config.elephant}_${config.period}_${currentBehavior}`;
        const bounds    = rsfBounds[boundsKey];

        if (bounds) {
            const imgUrl  = `data/rsf_maps/${config.elephant}_${config.period}_${currentBehavior}_${currentMapType}.png`;
            const overlay = L.imageOverlay(imgUrl, bounds, { opacity: 0.85, crossOrigin: true });
            overlay.addTo(map);
            imageOverlays[config.id] = overlay;
        } else {
            console.warn(`No bounds/data for: ${boundsKey}`);
        }
    });
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================
function initializeEventListeners() {
    // Behavior buttons
    document.querySelectorAll('.behavior-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            document.querySelectorAll('.behavior-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentBehavior = e.currentTarget.dataset.behavior;
            updateOverlays();
        });
    });

    // Map-type buttons
    document.querySelectorAll('.map-type-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            document.querySelectorAll('.map-type-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentMapType = e.currentTarget.dataset.type;
            updateOverlays();
        });
    });

    // Layer toggle buttons
    document.querySelectorAll('.layer-toggle-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            const layer = e.currentTarget.dataset.layer;
            layerState[layer] = !layerState[layer];
            const active = layerState[layer];
            e.currentTarget.classList.toggle('active', active);

            if (layer === 'rsf') {
                updateOverlays();
            } else if (layer === 'studyArea') {
                toggleLayerGroup(studyAreaLayers, active);
            } else if (layer === 'homeRange') {
                toggleLayerGroup(homeRangeLayers, active);
            } else if (layer === 'fence') {
                toggleLayerGroup(fenceLayers, active);
            }
        });
    });
}

// ============================================================================
// STATS RENDERING
// ============================================================================
function renderElephantStats(statsData) {
    const elephants  = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'];
    const behaviors  = ['Foraging', 'Movement', 'Low-energy', 'Resting'];

    elephants.forEach(eid => {
        const container = document.getElementById(`stats-content-${eid.toLowerCase()}`);
        if (!container) return;

        const eleStats = statsData[eid];
        if (!eleStats) {
            container.innerHTML = "No data available.";
            return;
        }

        let html = "";
        ['PRE', 'POST'].forEach(stage => {
            if (eleStats[stage]) {
                const sData = eleStats[stage];
                const days  = sData.duration_days || 0;
                html += `<div class="stat-block">
                    <h4>${stage} Range (${days} days)</h4>
                    <ul class="stat-list">`;
                behaviors.forEach(b => {
                    const pct = sData.percentages[b] || 0;
                    html += `<li><span>${b}:</span> <span>${pct}%</span></li>`;
                });
                html += `</ul></div>`;
            }
        });
        container.innerHTML = html;
    });
}
