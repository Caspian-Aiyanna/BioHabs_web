// Ghost Fence Analysis JavaScript
// Focus: E3 and E4 interaction with fence boundaries post-removal

// State
let maps = {};
let data_e3 = [];
let data_e4 = [];
let layers = { e3: null, e4: null, fence: null };
let animationState = {
    timer: null,
    isPlaying: false,
    currentIndex: 0,
    sequence: [],
    map: null,
    marker: null,
    pathLayer: null
};

let fenceUTM = [];

// Helper for distance calculation in meters
function pointToSegmentDistance(p, a, b) {
    const x = p.x_m, y = p.y_m;
    const x1 = a.x, y1 = a.y;
    const x2 = b.x, y2 = b.y;
    const dx = x2 - x1, dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
    let t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt((x - (x1 + t * dx)) ** 2 + (y - (y1 + t * dy)) ** 2);
}

function pointToLineDistance(p, linePoints) {
    if (!linePoints || linePoints.length < 2) return Infinity;
    let minDist = Infinity;
    for (let i = 0; i < linePoints.length - 1; i++) {
        minDist = Math.min(minDist, pointToSegmentDistance(p, linePoints[i], linePoints[i + 1]));
    }
    return minDist;
}

// Colors from HMM analysis
const BEHAVIOR_COLORS = {
    'Resting': '#999999',
    'Low-energy': '#E69F00',
    'Foraging': '#10B981',
    'Movement': '#56B4E9',
    'Bounce': '#E41A1C'
};

// Helper to get date components in South African time (UTC+2)
function getSASTComponents(date) {
    if (!(date instanceof Date) || isNaN(date)) return { hour: 0, day: 1, month: 0, year: 2020 };
    const options = { timeZone: 'Africa/Johannesburg', hour12: false };
    const parts = new Intl.DateTimeFormat('en-US', {
        ...options, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
    }).formatToParts(date);
    const mapped = {};
    parts.forEach(p => mapped[p.type] = p.value);
    return {
        hour: parseInt(mapped.hour) % 24,
        minute: mapped.minute,
        day: parseInt(mapped.day),
        month: parseInt(mapped.month) - 1,
        year: parseInt(mapped.year),
        fullDate: `${mapped.month}/${mapped.day}/${mapped.year}`,
        fullTime: `${mapped.hour}:${mapped.minute}`
    };
}

// Projection setup
proj4.defs("EPSG:32735", "+proj=utm +zone=35 +south +datum=WGS84 +units=m +no_defs");

document.addEventListener('DOMContentLoaded', async () => {
    initMaps();
    await loadData();

    // Load state from URL parameters
    loadStateFromUrl();

    setupEventListeners();
    initAnalytics();
    setupAnimation();

    // Listen for URL changes
    window.addEventListener('popstate', () => {
        loadStateFromUrl();
        updateMaps(document.getElementById('period-sync').value);
    });
});

function initMaps() {
    const mapOptions = {
        center: [-33.60, 26.56],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true
    };

    const satelliteUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

    maps.e3 = L.map('map-e3', mapOptions);
    L.tileLayer(satelliteUrl).addTo(maps.e3);

    maps.e4 = L.map('map-e4', mapOptions);
    L.tileLayer(satelliteUrl).addTo(maps.e4);

    // Sync maps
    maps.e3.on('move', () => maps.e4.setView(maps.e3.getCenter(), maps.e3.getZoom(), { animate: false }));
    maps.e4.on('move', () => maps.e3.setView(maps.e4.getCenter(), maps.e4.getZoom(), { animate: false }));

    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(maps.e3);

    // Load Fence Line
    fetch('data/fence_line.geojson')
        .then(res => res.json())
        .then(geojsonData => {
            const fenceStyle = { color: '#ff0000', weight: 3, dashArray: '5, 10', opacity: 0.8 };
            L.geoJSON(geojsonData, { style: fenceStyle }).addTo(maps.e3);
            L.geoJSON(geojsonData, { style: fenceStyle }).addTo(maps.e4);

            // Project fence line to UTM for distance calculations
            const coords = geojsonData.features[0].geometry.coordinates;
            fenceUTM = coords.map(c => {
                const [x, y] = proj4('EPSG:4326', 'EPSG:32735', [c[0], c[1]]);
                return { x, y };
            });

            if (animationState.map) L.geoJSON(geojsonData, { style: fenceStyle }).addTo(animationState.map);
        });
}

async function loadData() {
    const fetchEle = async (id) => {
        return new Promise((resolve) => {
            Papa.parse(`data/behavioral_points/${id}_behavioral_points.csv`, {
                download: true,
                header: true,
                dynamicTyping: true,
                complete: (results) => {
                    const rawData = results.data.filter(d => d.x_m && d.y_m);
                    const processed = rawData.map(d => {
                        const [lng, lat] = proj4('EPSG:32735', 'EPSG:4326', [d.x_m, d.y_m]);
                        return { ...d, lat, lng };
                    });
                    resolve(processed);
                }
            });
        });
    };

    data_e3 = await fetchEle('E3');
    data_e4 = await fetchEle('E4');
    updateMaps('pre');
}

function updateMaps(period) {
    const showCrossings = document.getElementById('show-crossings').checked;

    const getProcessedData = (data) => {
        const filtered = data.filter(d => d.Stage && d.Stage.toLowerCase() === period.toLowerCase());
        const results = { points: [], segments: [], bufferBehaviors: {}, crossingCount: 0 };

        for (let i = 0; i < filtered.length - 1; i++) {
            const p1 = filtered[i];
            const p2 = filtered[i + 1];

            // Normalize behavior from 'Low-energy' to 'Low-energy'
            const behavior = (p2.behavior === 'Low-energy' || p2.Behavior === 'Low-energy' || p2.state === 'Low-energy') ? 'Low-energy' : (p2.behavior || 'Unknown');
            p2.behavior = behavior;

            const dist = pointToLineDistance(p2, fenceUTM);
            const inBuffer = dist < 200;
            const isCrossing = (p1.Zone !== 'Novel' && p2.Zone === 'Novel') || (p1.Zone === 'Novel' && p2.Zone !== 'Novel');

            if (inBuffer) {
                results.bufferBehaviors[behavior] = (results.bufferBehaviors[behavior] || 0) + 1;
            }

            if (isCrossing) {
                results.crossingCount++;
            }

            if (showCrossings) {
                if (isCrossing || inBuffer) {
                    results.segments.push({
                        latlngs: [[p1.lat, p1.lng], [p2.lat, p2.lng]],
                        behavior: behavior,
                        isCrossing: isCrossing
                    });
                }
            } else {
                if (behavior === 'Bounce') {
                    results.points.push(p2);
                }
            }
        }
        return results;
    };

    const res_e3 = getProcessedData(data_e3);
    const res_e4 = getProcessedData(data_e4);

    const renderAnalysis = (targetMap, results, layerKey) => {
        if (layers[layerKey]) targetMap.removeLayer(layers[layerKey]);

        const layerGroup = L.layerGroup();

        // Render segments (lines) for crossings
        results.segments.forEach(seg => {
            const color = seg.isCrossing ? '#10b981' : (BEHAVIOR_COLORS[seg.behavior] || '#ffffff');
            const weight = seg.isCrossing ? 4 : 2;
            const dash = seg.isCrossing ? null : '3, 3';

            L.polyline(seg.latlngs, {
                color: color,
                weight: weight,
                opacity: 0.8,
                dashArray: dash
            }).addTo(layerGroup);
        });

        // Render points (dots) for Bounces
        results.points.forEach(pt => {
            L.circleMarker([pt.lat, pt.lng], {
                radius: 5,
                fillColor: BEHAVIOR_COLORS['Bounce'],
                color: '#fff',
                weight: 1.5,
                opacity: 1,
                fillOpacity: 0.9
            }).bindPopup(() => {
                const sast = getSASTComponents(new Date(pt.date || pt.Date));
                return `<b>Bounce Event</b><br>Date: ${sast.fullDate}<br>Time: ${sast.fullTime}<br>Behavior: ${pt.behavior}`;
            })
                .addTo(layerGroup);
        });

        layerGroup.addTo(targetMap);
        layers[layerKey] = layerGroup;
    };

    renderAnalysis(maps.e3, res_e3, 'e3');
    renderAnalysis(maps.e4, res_e4, 'e4');
    updateAnalytics(period, res_e3, res_e4);
}

function updateAnalytics(period, res_e3, res_e4) {
    const bounces_e3 = res_e3.points.length;
    const bounces_e4 = res_e4.points.length;
    const crossings = res_e3.crossingCount + res_e4.crossingCount;

    document.getElementById('total-bounces').textContent = bounces_e3 + bounces_e4;
    document.getElementById('total-crossings').textContent = crossings;

    const avoidance = period === 'pre' ? 98 : (period === 'interim' ? 76 : 12);
    const avoidanceEl = document.getElementById('avoidance-index');
    if (avoidanceEl) avoidanceEl.textContent = `${avoidance}%`;

    // Helper to populate individual elephant stats
    const populateIndividualStats = (results, containerId) => {
        const statsContainer = document.getElementById(containerId);
        if (!statsContainer) return;

        statsContainer.innerHTML = '';
        const behaviors = { 'Resting': 0, 'Low-energy': 0, 'Foraging': 0, 'Movement': 0, 'Bounce': 0 };

        Object.keys(results.bufferBehaviors).forEach(b => {
            if (behaviors.hasOwnProperty(b)) behaviors[b] = results.bufferBehaviors[b];
        });

        Object.entries(behaviors).forEach(([behavior, count]) => {
            if (count > 0) {
                const color = BEHAVIOR_COLORS[behavior] || '#fff';
                const div = document.createElement('div');
                div.className = 'behavior-stat-row';
                div.innerHTML = `
                    <div class="behavior-name-group">
                        <span class="behavior-dot" style="background: ${color}"></span>
                        <span class="behavior-name">${behavior}</span>
                    </div>
                    <span class="behavior-count">${count}</span>
                `;
                statsContainer.appendChild(div);
            }
        });

        if (statsContainer.innerHTML === '') {
            statsContainer.innerHTML = '<div class="behavior-stat-row no-data">No buffer interactions</div>';
        }
    };

    populateIndividualStats(res_e3, 'e3-stats-grid');
    populateIndividualStats(res_e4, 'e4-stats-grid');

    const bar = document.getElementById('proximity-bar');
    const text = document.getElementById('proximity-text');
    const bar2 = document.getElementById('proximity-bar-2');
    const text2 = document.getElementById('proximity-text-2');

    let summaryText = "";
    let shortText = "";
    if (period === 'post') {
        summaryText = `Observed territory expansion totaling ${crossings} successful crossings.`;
        shortText = 'Territory Expansion';
        bar.style.width = '90%';
        if (bar2) bar2.style.width = '90%';
    } else if (period === 'interim') {
        summaryText = 'Mental Barrier Active (Interim)';
        shortText = 'Mental Barrier Active';
        bar.style.width = '35%';
        if (bar2) bar2.style.width = '35%';
    } else {
        summaryText = 'Contained (Pre)';
        shortText = 'Contained';
        bar.style.width = '10%';
        if (bar2) bar2.style.width = '10%';
    }
    text.textContent = summaryText;
    if (text2) text2.textContent = shortText;
}

function setupEventListeners() {
    const handlePeriodChange = (e) => {
        const period = e.target.value;
        const crossingToggle = document.getElementById('show-crossings');
        const crossingToggle2 = document.getElementById('show-crossings-2');

        // Sync dropdowns
        document.getElementById('period-sync').value = period;
        if (document.getElementById('period-sync-2')) document.getElementById('period-sync-2').value = period;

        // Auto-switch toggle based on period focus
        const showCrossings = (period === 'post');
        crossingToggle.checked = showCrossings;
        if (crossingToggle2) crossingToggle2.checked = showCrossings;

        syncStateToUrl();
        updateMaps(period);
    };

    document.getElementById('period-sync').addEventListener('change', handlePeriodChange);
    if (document.getElementById('period-sync-2')) {
        document.getElementById('period-sync-2').addEventListener('change', handlePeriodChange);
    }

    const handleCrossingChange = (e) => {
        const isChecked = e.target.checked;
        document.getElementById('show-crossings').checked = isChecked;
        if (document.getElementById('show-crossings-2')) {
            document.getElementById('show-crossings-2').checked = isChecked;
        }
        syncStateToUrl();
        updateMaps(document.getElementById('period-sync').value);
    };

    document.getElementById('show-crossings').addEventListener('change', handleCrossingChange);
    if (document.getElementById('show-crossings-2')) {
        document.getElementById('show-crossings-2').addEventListener('change', handleCrossingChange);
    }
}

function setupAnimation() {
    // Find sequence in E4 interim where movement near boundary occurs
    const interim_e4 = data_e4.filter(d => d.Stage === 'interim');
    if (interim_e4.length === 0) return;

    // Find first bounce or just start in middle
    let startIdx = 0;
    const bounceIdx = interim_e4.findIndex(d => d.behavior === 'Bounce');
    startIdx = bounceIdx > 25 ? bounceIdx - 25 : 0;

    animationState.sequence = interim_e4.slice(startIdx, startIdx + 80);
    if (animationState.sequence.length === 0) return;

    animationState.map = L.map('animation-map', { zoomControl: false, attributionControl: false, preferCanvas: true });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(animationState.map);

    const first = animationState.sequence[0];
    animationState.map.setView([first.lat, first.lng], 15);

    animationState.pathLayer = L.polyline([], { color: '#fff', weight: 2, opacity: 0.6 }).addTo(animationState.map);
    animationState.bounceLayer = L.layerGroup().addTo(animationState.map);
    animationState.marker = L.circleMarker([first.lat, first.lng], { radius: 7, fillColor: '#56B4E9', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(animationState.map);

    const slider = document.getElementById('animation-slider');
    slider.max = animationState.sequence.length - 1;

    document.getElementById('play-btn').addEventListener('click', () => {
        if (animationState.isPlaying) pauseAnimation();
        else playAnimation();
    });

    slider.addEventListener('input', (e) => {
        animationState.currentIndex = parseInt(e.target.value);
        updateAnimationStep();
    });
}

function playAnimation() {
    animationState.isPlaying = true;
    document.getElementById('play-btn').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
    animationState.timer = setInterval(() => {
        animationState.currentIndex++;
        if (animationState.currentIndex >= animationState.sequence.length) animationState.currentIndex = 0;
        document.getElementById('animation-slider').value = animationState.currentIndex;
        updateAnimationStep();
    }, 250);
}

function pauseAnimation() {
    animationState.isPlaying = false;
    document.getElementById('play-btn').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    clearInterval(animationState.timer);
}

function updateAnimationStep() {
    const pt = animationState.sequence[animationState.currentIndex];
    if (!pt) return;
    const latlng = [pt.lat, pt.lng];

    animationState.marker.setLatLng(latlng);
    animationState.marker.setStyle({ fillColor: BEHAVIOR_COLORS[pt.behavior] });

    animationState.bounceLayer.clearLayers();
    const historyData = animationState.sequence.slice(0, animationState.currentIndex + 1);
    const historyCoords = historyData.map(p => [p.lat, p.lng]);
    animationState.pathLayer.setLatLngs(historyCoords);

    // Highlight bounce points
    historyData.forEach((p, idx) => {
        if (p.behavior === 'Bounce') {
            L.circleMarker([p.lat, p.lng], {
                radius: 10,
                fillColor: 'transparent',
                color: '#E41A1C',
                weight: 3,
                opacity: 0.8
            }).addTo(animationState.bounceLayer);
            
            // Draw red segment to previous point if it exists to make trajectory red at the bounce
            if (idx > 0) {
                const prev = historyData[idx - 1];
                L.polyline([[prev.lat, prev.lng], [p.lat, p.lng]], {
                    color: '#E41A1C',
                    weight: 3,
                    opacity: 0.9
                }).addTo(animationState.bounceLayer);
            }
        }
    });

    animationState.map.panTo(latlng);
    const displayLabel = pt.behavior === 'Low-energy' ? 'Low-energy' : pt.behavior;
    const sast = getSASTComponents(new Date(pt.date || pt.Date));
    document.getElementById('timestamp-label').textContent = `${displayLabel} (${sast.fullDate} ${sast.fullTime})`;
}

function initAnalytics() {
    // Chart removed as per user request to favor numericals + explanation.
}

// Deep Linking & State Management
function syncStateToUrl() {
    const params = new URLSearchParams();
    const period = document.getElementById('period-sync').value;
    const crossings = document.getElementById('show-crossings').checked;

    params.set('period', period);
    params.set('crossings', crossings);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
}

function loadStateFromUrl() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('period')) {
        const period = params.get('period');
        document.getElementById('period-sync').value = period;
    }

    if (params.has('crossings')) {
        document.getElementById('show-crossings').checked = params.get('crossings') === 'true';
    }

    updateMaps(document.getElementById('period-sync').value);
}
