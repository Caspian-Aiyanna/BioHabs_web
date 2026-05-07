// Behavioral Analysis JavaScript
// Handles data loading, processing, and visualization for elephant behavioral states

// Global state
const UIManager = {}; // UI Interaction Namespace
let behavioralData = {};
let currentElephant = 'E1';
let currentPeriod = 'PRE';
let currentAnalysis = 'time-budget';
let currentBaciMode = 'absolute'; // 'absolute' or 'delta'
let currentSeasonalMode = 'percent'; // 'percent' or 'count'
let currentTemporalMode = 'percent'; // 'percent' or 'count'
let charts = {};
let heatmapInstance = null;
let globalBehavioralSummaries = null; // Cache for pre-aggregated JSON
let populationCache = null; // High-level cache for ALL elephants (contains all stages)

// Helper to format date
UIManager.formatDate = function(d) {
    if (!d) return 'N/A';
    if (typeof d === 'string') {
        return new Date(d).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' });
    }
    return d.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' });
};
window.formatDate = UIManager.formatDate;

function parseDateSAST(date) {
    if (!(date instanceof Date) || isNaN(date)) return null;

    // Use Intl API to extract components in SAST
    const options = { timeZone: 'Africa/Johannesburg', hour12: false };
    const parts = new Intl.DateTimeFormat('en-US', {
        ...options,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric'
    }).formatToParts(date);

    const mapped = {};
    parts.forEach(p => mapped[p.type] = p.value);

    return {
        hour: parseInt(mapped.hour) % 24,
        day: parseInt(mapped.day),
        month: parseInt(mapped.month) - 1, // JS 0-indexed months
        year: parseInt(mapped.year)
    };
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    setChartDefaults();
    initializeEventListeners();

    // Load state from URL parameters before initial data load
    loadStateFromUrl();

    loadBehavioralData(currentElephant, currentPeriod);

    // Listen for URL changes (back/forward buttons)
    window.addEventListener('popstate', () => {
        loadStateFromUrl();
        loadBehavioralData(currentElephant, currentPeriod);
    });

    // Listen for theme changes to update chart colors
    window.addEventListener('themeChanged', (e) => {
        setChartDefaults();
        updateVisualization();
    });
});

function setChartDefaults() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const textColor = isLight ? '#334155' : '#e2e8f0';
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.1)';

    Chart.defaults.color = textColor;
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.plugins.tooltip.backgroundColor = isLight ? 'rgba(255, 255, 255, 0.9)' : 'rgba(30, 41, 59, 0.9)';
    Chart.defaults.plugins.tooltip.titleColor = textColor;
    Chart.defaults.plugins.tooltip.bodyColor = textColor;
    Chart.defaults.plugins.tooltip.borderColor = gridColor;
    Chart.defaults.plugins.tooltip.borderWidth = 1;

    // Disable default animation for instant rendering when toggling datasets
    Chart.defaults.animation = false;
}

// Event Listeners
function initializeEventListeners() {
    // Elephant selection
    document.querySelectorAll('.elephant-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.elephant-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentElephant = e.target.dataset.elephant;
            syncStateToUrl();
            loadBehavioralData(currentElephant, currentPeriod);
        });
    });

    // Period selection
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentPeriod = e.target.dataset.period;
            syncStateToUrl();
            loadBehavioralData(currentElephant, currentPeriod);
        });
    });

    // Dashboard Card Interactions
    document.querySelectorAll('.mini-viz-card').forEach(card => {
        card.addEventListener('click', (e) => {
            // Prevent if clicking on controls inside the card (if any)
            if (e.target.closest('select') || e.target.closest('button')) return;
            openModal(card.dataset.viz);
        });
    });

    // Modal Controls
    const closeModalBtn = document.getElementById('close-modal-btn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeModal);
    }

    const modal = document.getElementById('viz-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
        });
    }

    // Download chart (Update to download active modal chart or default to first?)
    document.getElementById('download-chart')?.addEventListener('click', downloadCurrentChart);

    // Global year filter
    document.getElementById('global-year-select').addEventListener('change', () => {
        updateVisualization();
    });

    // Seasonal pattern controls
    document.getElementById('year-select').addEventListener('change', () => {
        renderSeasonalPatterns();
    });

    document.getElementById('month-select').addEventListener('change', () => {
        renderSeasonalPatterns();
    });
}

// Deep Linking & State Management
function syncStateToUrl() {
    const params = new URLSearchParams();
    params.set('elephant', currentElephant);
    params.set('period', currentPeriod);
    params.set('analysis', currentAnalysis);
    params.set('seasonalMode', currentSeasonalMode);
    params.set('temporalMode', currentTemporalMode);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
}

function loadStateFromUrl() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('elephant')) {
        currentElephant = params.get('elephant');
        // Update UI
        document.querySelectorAll('.elephant-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.elephant === currentElephant);
        });
    }

    if (params.has('period')) {
        currentPeriod = params.get('period');
        // Update UI
        document.querySelectorAll('.period-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.period === currentPeriod);
        });
    }

    // Analysis param is deprecated in dashboard view but we keep listener for compatibility
}

// Load behavioral data
async function loadBehavioralData(elephant, period) {
    showLoading(true);

    try {
        if (!globalBehavioralSummaries) {
            const response = await fetch('data/behavioral_summaries.json');
            globalBehavioralSummaries = await response.json();
        }

        let filteredRecords = globalBehavioralSummaries.records;
        
        if (elephant === 'MALES') {
            filteredRecords = filteredRecords.filter(r => ['E1', 'E2', 'E6'].includes(r.Elephant));
        } else if (elephant === 'FEMALES') {
            filteredRecords = filteredRecords.filter(r => ['E3', 'E4', 'E5'].includes(r.Elephant));
        } else if (elephant !== 'ALL') {
            filteredRecords = filteredRecords.filter(r => r.Elephant === elephant);
        }

        if (elephant === 'ALL' && period === 'ALL') {
            populationCache = filteredRecords;
        }

        let periodFiltered = filteredRecords;
        if (period !== 'ALL') {
            periodFiltered = filteredRecords.filter(r => r.Stage === period);
        }

        const summary = calculateSummary(periodFiltered, elephant, period);

        behavioralData = {
            elephant: elephant,
            period: period,
            data: periodFiltered,
            summary: summary
        };

        updateStatistics(summary);
        updateVisualization();

        showLoading(false);
    } catch (error) {
        console.error('Error loading behavioral data:', error);
        showLoading(false);
    }
}

// Calculate summary statistics
function calculateSummary(data, elephant, period) {
    let total = 0;
    const behaviors = {
        'Resting': 0,
        'Low-energy': 0,
        'Foraging': 0,
        'Movement': 0,
        'Bounce': 0
    };

    data.forEach(row => {
        let behavior = row.behavior_clean;
        if (behavior === 'Sleeping') behavior = 'Resting';  // remap legacy key
        let count = row.count || 1; 

        if (behavior === 'Low-energy') behavior = 'Low-energy';
        if (behavior) {
            behavior = behavior.charAt(0).toUpperCase() + behavior.slice(1).toLowerCase();
        }

        total += count;
        if (behaviors.hasOwnProperty(behavior)) {
            behaviors[behavior] += count;
        }
    });

    let minDateStr = null;
    let maxDateStr = null;
    let totalDuration = 0;

    if (globalBehavioralSummaries && globalBehavioralSummaries.metadata) {
        if (elephant !== 'ALL' && elephant !== 'MALES' && elephant !== 'FEMALES' && period !== 'ALL') {
            const meta = globalBehavioralSummaries.metadata[`${elephant}_${period}`];
            if (meta) {
                minDateStr = meta.min_date;
                maxDateStr = meta.max_date;
                totalDuration = meta.duration;
            }
        } else {
            let minD = null;
            let maxD = null;
            let dur = 0;
            const eleList = elephant === 'ALL' ? ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'] :
                          elephant === 'MALES' ? ['E1', 'E2', 'E6'] :
                          elephant === 'FEMALES' ? ['E3', 'E4', 'E5'] : [elephant];
            const perList = period === 'ALL' ? ['PRE', 'INTERIM', 'POST'] : [period];
            
            eleList.forEach(e => {
                perList.forEach(p => {
                    const m = globalBehavioralSummaries.metadata[`${e}_${p}`];
                    if (m) {
                        const m_min = new Date(m.min_date);
                        const m_max = new Date(m.max_date);
                        if (!minD || m_min < minD) minD = m_min;
                        if (!maxD || m_max > maxD) maxD = m_max;
                        dur += m.duration;
                    }
                });
            });
            if (minD) minDateStr = minD.toISOString();
            if (maxD) maxDateStr = maxD.toISOString();
            totalDuration = dur;
        }
    }

    return {
        total,
        behaviors,
        percentages: {
            Resting:       total > 0 ? ((behaviors.Resting         / total) * 100).toFixed(1) : 0,
            'Low-energy':  total > 0 ? ((behaviors['Low-energy']   / total) * 100).toFixed(1) : 0,
            resting:       total > 0 ? ((behaviors['Low-energy']   / total) * 100).toFixed(1) : 0, // legacy alias for updateStatistics
            foraging:      total > 0 ? ((behaviors.Foraging        / total) * 100).toFixed(1) : 0,
            Foraging:      total > 0 ? ((behaviors.Foraging        / total) * 100).toFixed(1) : 0,
            movement:      total > 0 ? ((behaviors.Movement        / total) * 100).toFixed(1) : 0,
            bounce:        total > 0 ? ((behaviors.Bounce          / total) * 100).toFixed(1) : 0
        },
        dateRange: {
            min: minDateStr ? new Date(minDateStr) : null,
            max: maxDateStr ? new Date(maxDateStr) : null
        },
        duration: totalDuration
    };
}

// Update statistics display
function updateStatistics(summary) {
    document.getElementById('total-points').textContent = summary.total.toLocaleString();
    document.getElementById('Resting-pct').textContent = `${summary.percentages.Resting}%`;
    document.getElementById('resting-pct').textContent = `${summary.percentages.resting}%`;
    document.getElementById('foraging-pct').textContent = `${summary.percentages.foraging}%`;
    document.getElementById('movement-pct').textContent = `${summary.percentages.movement}%`;
    document.getElementById('bounce-pct').textContent = `${summary.percentages.bounce}%`;

    const formatDate = (d) => d ? d.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' }) : 'N/A';
    if (summary.dateRange.min && summary.dateRange.max) {
        document.getElementById('date-range').textContent = `${formatDate(summary.dateRange.min)} - ${formatDate(summary.dateRange.max)}`;
    } else {
        document.getElementById('date-range').textContent = '-';
    }

    document.getElementById('duration-days').textContent = summary.duration > 0 ? summary.duration : '-';

    // Update rest-forage ratio
    const restingCount = summary.behaviors['Low-energy'] || 0;
    const foragingCount = summary.behaviors.Foraging || 0;
    const ratio = foragingCount > 0 ? (restingCount / foragingCount).toFixed(2) : '-';
    const ratioEl = document.getElementById('rest-forage-ratio');
    if (ratioEl) ratioEl.textContent = ratio;

    // Update elephant profile card
    updateElephantProfile();

    // Populate global year filter
    populateGlobalYearFilter();
}

function populateGlobalYearFilter() {
    const yearSelect = document.getElementById('global-year-select');
    const currentValue = yearSelect.value;

    yearSelect.innerHTML = '<option value="all">All Years</option>';

    const years = new Set();
    behavioralData.data.forEach(row => {
        if (row.year) years.add(row.year);
    });

    const sortedYears = Array.from(years).sort();
    sortedYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    });

    if (sortedYears.includes(parseInt(currentValue))) {
        yearSelect.value = currentValue;
    } else {
        yearSelect.value = 'all';
    }
}

function getFilteredData() {
    const selectedYear = document.getElementById('global-year-select').value;

    if (selectedYear === 'all') {
        return behavioralData.data;
    }

    return behavioralData.data.filter(row => row.year === parseInt(selectedYear));
}

// Update elephant profile card
function updateElephantProfile() {
    const elephantData = {
        'E1': { name: 'Kamva (E1)', image: 'Kamva_1.png', preRange: 'Kariega West', badge: 'KW → Kariega Game Reserve' },
        'E2': { name: 'Kambaku (E2)', image: 'Kambaku_1.jpg', preRange: 'Kariega West', badge: 'KW → Kariega Game Reserve' },
        'E3': { name: 'Bukela (E3)', image: 'Bukela_1.jpg', preRange: 'Kariega West', badge: 'KW → Kariega Game Reserve' },
        'E4': { name: 'Half Moon (E4)', image: 'Half_moon_1.jpg', preRange: 'Kariega West', badge: 'KW → Kariega Game Reserve' },
        'E5': { name: 'Beauty (E5)', image: 'Beauty_1.jpg', preRange: 'Harvestvale', badge: 'HV → Kariega Game Reserve' },
        'E6': { name: 'Balu (E6)', image: 'Balu_1.jpg', preRange: 'Harvestvale', badge: 'HV → Kariega Game Reserve' },
        'MALES': { name: 'All Males (E1, E2, E6)', image: 'elephant_main.jpg', preRange: 'Both Ranges', badge: 'Sex Aggregate' },
        'FEMALES': { name: 'All Females (E3, E4, E5)', image: 'elephant_main.jpg', preRange: 'Both Ranges', badge: 'Sex Aggregate' },
        'ALL': { name: 'All Elephants', image: 'elephant_main.jpg', preRange: 'Both Ranges', badge: 'Combined Data' }
    };

    const elephant = elephantData[currentElephant];
    if (elephant) {
        const imgEl = document.getElementById('profile-img');
        imgEl.src = `elephants/${elephant.image}`;
        imgEl.onerror = () => { imgEl.src = 'elephants/elephant_main.jpg'; }; // Fallback
        document.getElementById('profile-name').textContent = elephant.name;
        document.getElementById('profile-badge').textContent = elephant.badge;

        // Determine home range based on period
        let homeRange;
        if (currentPeriod === 'PRE') {
            homeRange = elephant.preRange;
        } else if (currentPeriod === 'INTERIM' || currentPeriod === 'POST') {
            const aggTypes = ['ALL', 'MALES', 'FEMALES'];
            homeRange = aggTypes.includes(currentElephant) ? 'Both Ranges' : 'Kariega Game Reserve';
        } else {
            homeRange = 'Multiple Ranges';
        }

        document.getElementById('profile-range').textContent = homeRange;
        document.getElementById('profile-period').textContent = currentPeriod;

        // Update data points
        if (behavioralData && behavioralData.summary) {
            document.getElementById('profile-points').textContent = behavioralData.summary.total.toLocaleString();
        }
    }
}

// Update visualization - Renders ALL charts for the dashboard
function updateVisualization() {
    // Check if we have data to work with
    if (!behavioralData.data) return;

    // Render all charts
    // We wrap in timeouts/animation frames to prevent main thread blocking and ensure canvas readiness
    requestAnimationFrame(() => {
        try { renderTimeBudgetChart(); } catch (e) { console.error('Time Budget failed:', e); }
        try { renderSeasonalPatterns(); } catch (e) { console.error('Seasonal Patterns failed:', e); }
        try { renderTemporalPattern(); } catch (e) { console.error('Temporal Pattern failed:', e); }
        try { renderPeriodComparison(); } catch (e) { console.error('Period Comparison failed:', e); }

        // Handle Modal resizing if active
        if (activeModalChart) {
            const chartKey = activeModalMapping[activeModalChart];
            if (charts[chartKey]) charts[chartKey].resize();
        }
    });
}

// Modal State Management
let activeModalChart = null;
const activeModalMapping = {
    'time-budget': 'timeBudget',
    'seasonal': 'seasonal',
    'temporal': 'temporal',
    'comparison': 'comparison'
};

function getTitleForViz(type) {
    const titles = {
        'time-budget': 'Time Budget Analysis',
        'seasonal': 'Seasonal Behavioral Patterns',
        'temporal': 'Temporal Activity Pattern (24h)',
        'comparison': 'BACI Period Comparison'
    };
    return titles[type] || 'Chart';
}

UIManager.openModal = function(vizType) {
    activeModalChart = vizType;
    const containerId = `container-${vizType}`;
    const card = document.getElementById(containerId).closest('.mini-viz-card');
    if (!card) return;

    card.classList.add('expanded-mode');
    
    // Add close button if not exists
    if (!card.querySelector('.close-expanded')) {
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.className = 'close-expanded';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            closeModal();
        };
        card.appendChild(closeBtn);
    }
    
    // Add overlay
    let overlay = document.getElementById('viz-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'viz-overlay';
        overlay.className = 'viz-overlay';
        overlay.onclick = closeModal;
        document.body.appendChild(overlay);
    }
    overlay.classList.add('active');
    
    // Resize chart
    const chartKey = activeModalMapping[vizType];
    const chart = charts[chartKey];
    if (chart) {
        updateChartFontSizes(chart, 'modal');
        setTimeout(() => {
            chart.resize();
            chart.update('none');
        }, 50);
    }
};
window.openModal = UIManager.openModal;

UIManager.closeModal = function() {
    if (!activeModalChart) return;
    const vizType = activeModalChart;
    const containerId = `container-${vizType}`;
    const container = document.getElementById(containerId);
    if (!container) return;
    const card = container.closest('.mini-viz-card');
    
    if (card) {
        card.classList.remove('expanded-mode');
        const closeBtn = card.querySelector('.close-expanded');
        if (closeBtn) closeBtn.remove();
        
        const chartKey = activeModalMapping[vizType];
        const chart = charts[chartKey];
        if (chart) {
            updateChartFontSizes(chart, 'mini');
            setTimeout(() => {
                chart.resize();
                chart.update('none');
            }, 50);
        }
    }
    
    const overlay = document.getElementById('viz-overlay');
    if (overlay) overlay.classList.remove('active');
    
    activeModalChart = null;
};
window.closeModal = UIManager.closeModal;

/**
 * Helper to update chart font sizes for different view modes
 * @param {Chart} chart 
 * @param {string} mode 'mini' or 'modal'
 */
UIManager.updateChartFontSizes = function(chart, mode) {
    if (!chart) return;
    const isModal = mode === 'modal';

    // Scale factors
    const tickSize = isModal ? 18 : 12;
    const axisTitleSize = isModal ? 20 : 14;
    const legendSize = isModal ? 18 : 13;
    const mainTitleSize = isModal ? 24 : 16;
    const padding = isModal ? 30 : 15;

    // Update Scales (Axis)
    if (chart.options.scales) {
        Object.entries(chart.options.scales).forEach(([key, scale]) => {
            if (!scale.ticks) scale.ticks = {};
            if (!scale.ticks.font) scale.ticks.font = {};
            scale.ticks.font.size = (key === 'x2') ? tickSize + 2 : tickSize; 
            scale.ticks.padding = isModal ? 10 : 3;

            if (scale.title && scale.title.display) {
                if (!scale.title.font) scale.title.font = {};
                scale.title.font.size = axisTitleSize;
                scale.title.font.weight = '700';
            }
        });
    }

    // Update Legend
    if (chart.options.plugins && chart.options.plugins.legend) {
        if (!chart.options.plugins.legend.labels) chart.options.plugins.legend.labels = {};
        if (!chart.options.plugins.legend.labels.font) chart.options.plugins.legend.labels.font = {};
        chart.options.plugins.legend.labels.font.size = legendSize;
        chart.options.plugins.legend.labels.padding = padding;
    }

    // Update Chart Title
    if (chart.options.plugins && chart.options.plugins.title) {
        if (!chart.options.plugins.title.font) chart.options.plugins.title.font = {};
        chart.options.plugins.title.font.size = mainTitleSize;
        chart.options.plugins.title.padding = isModal ? 30 : 10;
    }

    chart.update('none');
};
window.updateChartFontSizes = UIManager.updateChartFontSizes;

// De-activated switch analysis (Legacy)
function switchAnalysisView(analysisType) {
    // No-op in Dashboard mode
    console.log('Dashboard mode active - analysis switch ignored');
}

// Render time budget pie chart
function renderTimeBudgetChart() {
    const ctx = document.getElementById('time-budget-chart').getContext('2d');

    // Destroy existing chart
    if (charts.timeBudget) {
        charts.timeBudget.destroy();
    }

    // Use filtered data based on year selection
    const filteredData = getFilteredData();

    // Recalculate summary for filtered data
    const behaviorCounts = {
        Resting: 0,
        'Low-energy': 0,
        Foraging: 0,
        Movement: 0,
        Bounce: 0
    };

    filteredData.forEach(row => {
        let behavior = row.behavior_clean;
        if (behavior === 'Sleeping') behavior = 'Resting';  // remap legacy key
        if (behavior === 'Low-energy') behavior = 'Low-energy';
        if (behavior) {
            behavior = behavior.charAt(0).toUpperCase() + behavior.slice(1).toLowerCase();
        }
        
        let count = row.count || 1;

        if (behaviorCounts[behavior] !== undefined) {
            behaviorCounts[behavior] += count;
        }
    });

    charts.timeBudget = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Resting', 'Low-energy', 'Foraging', 'Movement', 'Bounce'],
            datasets: [{
                data: [
                    behaviorCounts.Resting,
                    behaviorCounts['Low-energy'],
                    behaviorCounts.Foraging,
                    behaviorCounts.Movement,
                    behaviorCounts.Bounce
                ],
                backgroundColor: [
                    'rgba(153, 153, 153, 0.8)', // Resting - grey
                    'rgba(230, 159, 0, 0.8)',   // Low-energy - orange
                    'rgba(16, 185, 129, 0.8)',   // Foraging - green
                    'rgba(86, 180, 233, 0.8)',   // Movement - light blue
                    'rgba(228, 26, 28, 0.8)'    // Bounce - red
                ],
                borderColor: [
                    'rgba(153, 153, 153, 1)',
                    'rgba(230, 159, 0, 1)',
                    'rgba(16, 185, 129, 1)',
                    'rgba(86, 180, 233, 1)',
                    'rgba(228, 26, 28, 1)'
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#e2e8f0',
                        font: {
                            size: 16,
                            family: 'Inter',
                            weight: '500'
                        },
                        padding: 30
                    }
                },
                title: {
                    display: true,
                    text: `${behavioralData.elephant} - ${behavioralData.period} Period`,
                    color: '#f1f5f9',
                    font: {
                        size: 20,
                        family: 'Inter',
                        weight: 'bold'
                    },
                    padding: 20
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value.toLocaleString()} points (${percentage}%)`;
                        }
                    }
                }
            },
            cutout: '40%'
        }
    });
}

// Render seasonal patterns
function renderSeasonalPatterns() {
    const ctx = document.getElementById('seasonal-chart').getContext('2d');

    // Destroy existing chart
    if (charts.seasonal) {
        charts.seasonal.destroy();
    }

    // Get selected year and month
    const yearSelectEl = document.getElementById('year-select');
    const monthSelectEl = document.getElementById('month-select');
    if (!yearSelectEl || !monthSelectEl) return;

    const selectedYear = yearSelectEl.value;
    const selectedMonth = monthSelectEl.value;

    // ALWAYS repopulate year selector based on current elephant's data
    const yearSelect = document.getElementById('year-select');
    const currentYearValue = yearSelect.value; 

    yearSelect.innerHTML = '<option value="all">All Years</option>';

    const years = new Set();
    behavioralData.data.forEach(row => {
        if (row.year) years.add(row.year);
    });

    const sortedYears = Array.from(years).sort();

    sortedYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    });

    if (sortedYears.includes(parseInt(currentYearValue))) {
        yearSelect.value = currentYearValue;
    } else {
        yearSelect.value = 'all';
    }

    let filteredData = behavioralData.data;

    if (yearSelect.value !== 'all') {
        filteredData = filteredData.filter(row => row.year === parseInt(yearSelect.value));
    }

    if (selectedMonth !== 'all') {
        filteredData = filteredData.filter(row => row.month === parseInt(selectedMonth));
    }

    // Group data by month
    const monthlyData = Array(12).fill(0).map(() => ({
        Resting: 0,
        'Low-energy': 0,
        Foraging: 0,
        Movement: 0,
        Bounce: 0
    }));

    filteredData.forEach(row => {
        if (row.month !== undefined) {
            const month = row.month - 1; // 0-indexed for array
            let behavior = row.behavior_clean;
            if (behavior === 'Sleeping') behavior = 'Resting';  // remap legacy key
            if (behavior === 'Low-energy') behavior = 'Low-energy';
            if (behavior) behavior = behavior.charAt(0).toUpperCase() + behavior.slice(1).toLowerCase();
            let count = row.count || 1;

            if (monthlyData[month] && monthlyData[month][behavior] !== undefined) {
                monthlyData[month][behavior] += count;
            }
        }
    });

    // Calculate summary statistics
    const behaviorCounts = {
        Resting: 0,
        'Low-energy': 0,
        Foraging: 0,
        Movement: 0,
        Bounce: 0
    };

    filteredData.forEach(row => {
        let behavior = row.behavior_clean;
        if (behavior === 'Sleeping') behavior = 'Resting';  // remap legacy key
        if (behavior === 'Low-energy') behavior = 'Low-energy';
        if (behavior) behavior = behavior.charAt(0).toUpperCase() + behavior.slice(1).toLowerCase();
        let count = row.count || 1;

        if (behaviorCounts[behavior] !== undefined) {
            behaviorCounts[behavior] += count;
        }
    });

    const dominantBehavior = Object.keys(behaviorCounts).reduce((a, b) =>
        behaviorCounts[a] > behaviorCounts[b] ? a : b
    );

    // Update summary
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let periodText = 'All Data';
    if (selectedYear !== 'all' && selectedMonth !== 'all') {
        periodText = `${monthNames[parseInt(selectedMonth) - 1]} ${selectedYear}`;
    } else if (selectedYear !== 'all') {
        periodText = selectedYear;
    } else if (selectedMonth !== 'all') {
        periodText = monthNames[parseInt(selectedMonth) - 1];
    }

    // Update summary removed for dashboard view - can be added back if dedicated elements exist
    // document.getElementById('seasonal-period-text').textContent = periodText;
    // document.getElementById('seasonal-obs').textContent = filteredData.length.toLocaleString();
    // document.getElementById('seasonal-dominant').textContent = dominantBehavior;

    // Render chart
    charts.seasonal = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: monthNames,
            datasets: [
                {
                    label: 'Resting',
                    data: monthlyData.map(m => m.Resting),
                    backgroundColor: 'rgba(153, 153, 153, 0.8)',
                    borderColor: 'rgba(153, 153, 153, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Low-energy',
                    data: monthlyData.map(m => m['Low-energy']),
                    backgroundColor: 'rgba(230, 159, 0, 0.8)',
                    borderColor: 'rgba(230, 159, 0, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Foraging',
                    data: monthlyData.map(m => m.Foraging),
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Movement',
                    data: monthlyData.map(m => m.Movement),
                    backgroundColor: 'rgba(86, 180, 233, 0.8)',
                    borderColor: 'rgba(86, 180, 233, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Bounce',
                    data: monthlyData.map(m => m.Bounce),
                    backgroundColor: 'rgba(228, 26, 28, 0.8)',
                    borderColor: 'rgba(228, 26, 28, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    title: {
                        display: true,
                        text: 'Month',
                        color: '#94a3b8'
                    }
                },
                x2: {
                    type: 'category',
                    labels: [
                        '', 'SUMMER', '',
                        '', 'AUTUMN', '',
                        '', 'WINTER', '',
                        '', 'SPRING', ''
                    ],
                    grid: { display: false },
                    ticks: {
                        color: '#94a3b8',
                        font: {
                            size: 13,
                            weight: '700',
                            family: 'Inter'
                        },
                        padding: 5
                    },
                    position: 'bottom'
                },
                y: {
                    stacked: true,
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    beginAtZero: true,
                    max: currentSeasonalMode === 'percent' ? 100 : undefined,
                    title: {
                        display: true,
                        text: currentSeasonalMode === 'percent' ? 'Proportion (%)' : 'Number of Observations',
                        color: '#e2e8f0',
                        font: { size: 14, weight: '600' }
                    },
                    ticks: {
                        color: '#e2e8f0',
                        font: { size: 12 },
                        callback: function (value) {
                            return currentSeasonalMode === 'percent' ? value + '%' : value.toLocaleString();
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#e2e8f0',
                        font: {
                            size: 16,
                            family: 'Inter',
                            weight: '500'
                        },
                        padding: 20
                    }
                },
                title: {
                    display: true,
                    text: `Monthly Behavioral Distribution - ${behavioralData.elephant} (${behavioralData.period})`,
                    color: '#f1f5f9',
                    font: {
                        size: 20,
                        family: 'Inter',
                        weight: 'bold'
                    },
                    padding: 20
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const label = context.dataset.label || '';
                            const value = context.parsed.y || 0;
                            if (currentSeasonalMode === 'percent') {
                                return `${label}: ${value.toFixed(1)}%`;
                            }
                            return `${label}: ${value.toLocaleString()} observations`;
                        }
                    }
                }
            }
        }
    });

    // If in percent mode, we need to transform the data
    if (currentSeasonalMode === 'percent') {
        const datasets = charts.seasonal.data.datasets;
        const labels = charts.seasonal.data.labels;

        for (let i = 0; i < labels.length; i++) {
            let total = 0;
            datasets.forEach(dataset => {
                total += dataset.data[i];
            });

            if (total > 0) {
                datasets.forEach(dataset => {
                    dataset.data[i] = (dataset.data[i] / total) * 100;
                });
            }
        }
        charts.seasonal.update();
    }
}

// Render temporal pattern (24-hour activity)
function renderTemporalPattern() {
    const canvas = document.getElementById('temporal-chart');
    if (!canvas) return;

    // Ensure container is visible before rendering to prevent dimension issues
    // Dashboard mode: container is always visible


    const ctx = canvas.getContext('2d');

    // Destroy existing chart and clear property
    if (charts.temporal) {
        charts.temporal.destroy();
        charts.temporal = null;
    }

    // Use filtered data based on year selection
    const filteredData = getFilteredData();

    // Group data by hour
    const hourlyData = Array(24).fill(0).map(() => ({
        Resting: 0,
        'Low-energy': 0,
        Foraging: 0,
        Movement: 0,
        Bounce: 0
    }));

    filteredData.forEach(row => {
        if (row.hour !== undefined) {
            const hour = row.hour;
            let behavior = row.behavior_clean;
            if (behavior === 'Sleeping') behavior = 'Resting';  // remap legacy key
            if (behavior === 'Low-energy') behavior = 'Low-energy';
            if (behavior) behavior = behavior.charAt(0).toUpperCase() + behavior.slice(1).toLowerCase();
            let count = row.count || 1;

            if (hourlyData[hour] && hourlyData[hour][behavior] !== undefined) {
                hourlyData[hour][behavior] += count;
            }
        }
    });

    // Also update currentAnalysis check if it exists (for safety)
    if (typeof currentAnalysis === 'undefined') currentAnalysis = 'time-budget';

    charts.temporal = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
            datasets: [
                {
                    label: 'Resting',
                    data: hourlyData.map(h => h.Resting),
                    backgroundColor: 'rgba(153, 153, 153, 0.8)',
                    borderColor: 'rgba(153, 153, 153, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Low-energy',
                    data: hourlyData.map(h => h['Low-energy']),
                    backgroundColor: 'rgba(230, 159, 0, 0.8)',
                    borderColor: 'rgba(230, 159, 0, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Foraging',
                    data: hourlyData.map(h => h.Foraging),
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Movement',
                    data: hourlyData.map(h => h.Movement),
                    backgroundColor: 'rgba(86, 180, 233, 0.8)',
                    borderColor: 'rgba(86, 180, 233, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Bounce',
                    data: hourlyData.map(h => h.Bounce),
                    backgroundColor: 'rgba(228, 26, 28, 0.8)',
                    borderColor: 'rgba(228, 26, 28, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: {
                        color: '#e2e8f0',
                        font: { size: 12 }
                    },
                    title: {
                        display: true,
                        text: 'Daily Hours (24h format)',
                        color: '#e2e8f0',
                        font: { size: 14, weight: '600' }
                    }
                },
                y: {
                    stacked: true,
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    beginAtZero: true,
                    max: currentTemporalMode === 'percent' ? 100 : undefined,
                    ticks: {
                        color: '#e2e8f0',
                        font: { size: 12 },
                        callback: function (value) {
                            return currentTemporalMode === 'percent' ? value + '%' : value.toLocaleString();
                        }
                    },
                    title: {
                        display: true,
                        text: currentTemporalMode === 'percent' ? 'Proportion (%)' : 'Number of Observations',
                        color: '#e2e8f0',
                        font: { size: 14, weight: '600' }
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#e2e8f0',
                        font: {
                            size: 16,
                            family: 'Inter',
                            weight: '500'
                        },
                        padding: 20
                    }
                },
                title: {
                    display: true,
                    text: '24-Hour Activity Pattern',
                    color: '#f1f5f9',
                    font: {
                        size: 20,
                        family: 'Inter',
                        weight: 'bold'
                    },
                    padding: 20
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const label = context.dataset.label || '';
                            const value = context.parsed.y || 0;
                            if (currentTemporalMode === 'percent') {
                                return `${label}: ${value.toFixed(1)}%`;
                            }
                            return `${label}: ${value.toLocaleString()} observations`;
                        }
                    }
                }
            }
        }
    });

    // If in percent mode, transform temporal data
    if (currentTemporalMode === 'percent') {
        const datasets = charts.temporal.data.datasets;
        for (let i = 0; i < 24; i++) {
            let total = 0;
            datasets.forEach(dataset => {
                total += dataset.data[i];
            });

            if (total > 0) {
                datasets.forEach(dataset => {
                    dataset.data[i] = (dataset.data[i] / total) * 100;
                });
            }
        }
        charts.temporal.update();
    }
}

// Render period comparison
async function renderPeriodComparison() {
    const ctx = document.getElementById('comparison-chart').getContext('2d');

    // Destroy existing chart
    if (charts.comparison) {
        charts.comparison.destroy();
    }

    showLoading(true);

    // Get selected year for filtering
    const selectedYear = document.getElementById('global-year-select').value;

    const periods = ['PRE', 'INTERIM', 'POST'];
    const periodData = { 'PRE': null, 'INTERIM': null, 'POST': null };

    if (!globalBehavioralSummaries) {
        showLoading(false);
        return;
    }

    let baseData = globalBehavioralSummaries.records;
    
    if (currentElephant === 'MALES') {
        baseData = baseData.filter(r => ['E1', 'E2', 'E6'].includes(r.Elephant));
    } else if (currentElephant === 'FEMALES') {
        baseData = baseData.filter(r => ['E3', 'E4', 'E5'].includes(r.Elephant));
    } else if (currentElephant !== 'ALL') {
        baseData = baseData.filter(r => r.Elephant === currentElephant);
    }

    if (selectedYear !== 'all') {
        baseData = baseData.filter(r => r.year === parseInt(selectedYear));
    }

    periods.forEach(period => {
        const periodFiltered = baseData.filter(r => r.Stage === period);
        const summary = calculateSummary(periodFiltered, currentElephant, period);
        if (summary.total > 0) {
            periodData[period] = summary;
        }
    });

    if (Object.keys(periodData).filter(k => periodData[k]).length === 0) {
        console.warn('No data found for any period in BACI Comparison');
        showLoading(false);
        return;
    }

    renderBACIComparisonUI(ctx, periodData, currentElephant, currentPeriod);
    showLoading(false);
}

// Dedicated function to render the BACI comparison chart UI
function renderBACIComparisonUI(ctx, periodData, elephantId, currentPeriod) {
    if (charts.comparison) {
        charts.comparison.destroy();
    }

    const isDelta = currentBaciMode === 'delta';
    const datasets = [];
    const behaviors = ['Resting', 'Low-energy', 'foraging', 'movement', 'bounce'];

    if (periodData.PRE) {
        datasets.push({
            label: isDelta ? 'PRE (Baseline)' : 'PRE - HOME RANGE',
            data: behaviors.map(b => isDelta ? 0 : periodData.PRE.percentages[b]),
            backgroundColor: currentPeriod === 'PRE' ? 'rgba(59, 130, 246, 0.9)' : 'rgba(59, 130, 246, 0.4)',
            borderColor: 'rgb(59, 130, 246)',
            borderWidth: currentPeriod === 'PRE' ? 2 : 1
        });
    }

    if (periodData.INTERIM) {
        datasets.push({
            label: isDelta ? 'Interim (Δ %)' : 'Interim',
            data: behaviors.map(b => isDelta ? (periodData.INTERIM.percentages[b] - (periodData.PRE ? periodData.PRE.percentages[b] : 0)) : periodData.INTERIM.percentages[b]),
            backgroundColor: currentPeriod === 'INTERIM' ? 'rgba(245, 158, 11, 0.9)' : 'rgba(245, 158, 11, 0.4)',
            borderColor: 'rgb(245, 158, 11)',
            borderWidth: currentPeriod === 'INTERIM' ? 2 : 1
        });
    }

    if (periodData.POST) {
        datasets.push({
            label: isDelta ? 'POST (Δ %)' : 'POST - NOVEL RANGE',
            data: behaviors.map(b => isDelta ? (periodData.POST.percentages[b] - (periodData.PRE ? periodData.PRE.percentages[b] : 0)) : periodData.POST.percentages[b]),
            backgroundColor: currentPeriod === 'POST' ? 'rgba(16, 185, 129, 0.9)' : 'rgba(16, 185, 129, 0.4)',
            borderColor: 'rgb(16, 185, 129)',
            borderWidth: currentPeriod === 'POST' ? 2 : 1
        });
    }

    charts.comparison = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Resting', 'Low-energy', 'Foraging', 'Movement', 'Bounce'],
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#e2e8f0' }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)',
                        zeroLineColor: '#f1f5f9',
                        zeroLineWidth: 2
                    },
                    ticks: { color: '#e2e8f0' },
                    title: {
                        display: true,
                        text: isDelta ? 'Change relative to Pre (%)' : 'Percentage (%)',
                        color: '#e2e8f0'
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#e2e8f0',
                        font: {
                            size: 16,
                            family: 'Inter',
                            weight: '500'
                        },
                        padding: 20
                    }
                },
                title: {
                    display: true,
                    text: `${isDelta ? 'BACI Behavioral Shift' : 'Time Budget Comparison'} - ${elephantId === 'ALL' ? 'All Elephants' : (elephantId === 'MALES' ? 'All Males' : (elephantId === 'FEMALES' ? 'All Females' : elephantId))} ${currentPeriod !== 'ALL' ? `(Focal: ${currentPeriod})` : ''}`,
                    color: '#f1f5f9',
                    font: {
                        size: 20,
                        family: 'Inter',
                        weight: 'bold'
                    },
                    padding: 20
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toFixed(1) + '%';
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

// Download current chart
function downloadCurrentChart() {
    let originalCanvas;
    let fallbackFilename = 'elephant_analysis';

    // 1. If modal is open, download THAT chart
    if (activeModalChart) {
        const stage = document.getElementById('modal-chart-stage');
        originalCanvas = stage.querySelector('canvas');
        fallbackFilename = activeModalChart;
    }
    // 2. Otherwise, default to the Time Budget chart (top-left)
    else {
        originalCanvas = document.getElementById('time-budget-chart');
        fallbackFilename = 'time_budget_overview';
    }

    if (!originalCanvas) {
        console.error('No canvas found to download');
        return;
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `${fallbackFilename}_${currentElephant}_${currentPeriod}_${dateStr}.png`;

    // Create a temporary canvas to add the background
    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d');

    // Match dimensions
    tempCanvas.width = originalCanvas.width;
    tempCanvas.height = originalCanvas.height;

    // Fill with the dark theme background color (#111827)
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    // Draw the original chart on top
    ctx.drawImage(originalCanvas, 0, 0);

    // Download the result
    const url = tempCanvas.toDataURL('image/png', 1.0);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
}

// Show/hide loading overlay
function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (show) {
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

// Export for use in other modules
window.behavioralAnalysis = {
    loadBehavioralData,
    switchAnalysisView,
    downloadCurrentChart
};

// ==========================================
// PUBLICATION GALLERY LOGIC
// ==========================================
window.copyCitation = function(imageName) {
    const cleanName = imageName.replace('.png', '').replace(/_/g, ' ');
    const citationText = `Figure: ${cleanName}. Generated from the BioHabs Elephant Movement Analysis Dashboard, 2026.`;
    
    // Copy to clipboard
    navigator.clipboard.writeText(citationText).then(() => {
        // Show Toast Notification
        let toast = document.getElementById('citation-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'citation-toast';
            toast.className = 'toast-notification';
            document.body.appendChild(toast);
        }
        
        toast.textContent = "Citation copied to clipboard!";
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }).catch(err => {
        console.error('Failed to copy citation: ', err);
    });
};
