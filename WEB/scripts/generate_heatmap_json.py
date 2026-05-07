"""
generate_heatmap_json.py
Converts behavioral GPS points (UTM Zone 35S) from each elephant CSV
into small heatmap JSON files: [lat, lng, intensity, ...]
Output: data/rsf_maps/{Elephant}_{period}_{Behavior}_heatmap.json
"""

import csv, json, os, math
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────
DATA_DIR    = Path(r"d:\PhD\website\iSSA\WEB\data")
POINTS_DIR  = DATA_DIR / "behavioral_points"
OUT_DIR     = DATA_DIR / "rsf_maps"
OUT_DIR.mkdir(exist_ok=True)

# ── UTM Zone 35S → WGS84 (simple Transverse Mercator approximation) ──────────
# Using pyproj if available, else a pure-python fallback via the EPSG:32735 formula
try:
    from pyproj import Transformer
    _transformer = Transformer.from_crs("EPSG:32735", "EPSG:4326", always_xy=True)
    def utm_to_latlon(x_m, y_m):
        lon, lat = _transformer.transform(x_m, y_m)
        return lat, lon
    print("Using pyproj for coordinate transformation.")
except ImportError:
    # Pure-python Transverse Mercator inversion for UTM Zone 35S
    # Sufficient accuracy (~1 m) for heatmap visualisation
    import math
    def utm_to_latlon(x_m, y_m):
        # WGS84 ellipsoid
        a   = 6378137.0
        f   = 1 / 298.257223563
        b   = a * (1 - f)
        e2  = 1 - (b/a)**2
        e   = math.sqrt(e2)
        k0  = 0.9996
        # Zone 35 central meridian = 27° E
        lon0 = math.radians(27.0)
        # Southern hemisphere: y' = y - 10,000,000
        y_adj = y_m - 10_000_000.0
        x_adj = x_m - 500_000.0
        M = y_adj / k0
        mu = M / (a * (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256))
        e1 = (1 - math.sqrt(1-e2)) / (1 + math.sqrt(1-e2))
        phi1 = mu + (3*e1/2 - 27*e1**3/32)*math.sin(2*mu) \
                  + (21*e1**2/16 - 55*e1**4/32)*math.sin(4*mu) \
                  + (151*e1**3/96)*math.sin(6*mu) \
                  + (1097*e1**4/512)*math.sin(8*mu)
        N1  = a / math.sqrt(1 - e2*math.sin(phi1)**2)
        T1  = math.tan(phi1)**2
        C1  = e2/(1-e2) * math.cos(phi1)**2
        R1  = a*(1-e2) / (1 - e2*math.sin(phi1)**2)**1.5
        D   = x_adj / (N1*k0)
        lat = phi1 - (N1*math.tan(phi1)/R1) * (
                D**2/2
              - (5+3*T1+10*C1-4*C1**2-9*e2/(1-e2))*D**4/24
              + (61+90*T1+298*C1+45*T1**2-252*e2/(1-e2)-3*C1**2)*D**6/720)
        lon = lon0 + (D - (1+2*T1+C1)*D**3/6
              + (5-2*C1+(28*T1)-3*C1**2+8*e2/(1-e2)+24*T1**2)*D**5/120) / math.cos(phi1)
        return math.degrees(lat), math.degrees(lon)
    print("pyproj not found — using built-in TM inversion.")

# ── Behavior / Stage normalization ────────────────────────────────────────────
BEHAVIOR_MAP = {
    "foraging":   "Foraging",
    "movement":   "Movement",
    "resting":    "Resting",
    "sleeping":   "Sleeping",
}
STAGE_MAP = {
    "pre":     "pre",
    "interim": "interim",
    "post":    "post",
}

ELEPHANTS = ["E1", "E2", "E3", "E4", "E5", "E6"]

# ── Accumulator: {elephant: {period: {behavior: [(lat, lng), ...]}}} ──────────
data = {}

for elephant in ELEPHANTS:
    csv_file = POINTS_DIR / f"{elephant}_behavioral_points.csv"
    if not csv_file.exists():
        print(f"  ⚠ Missing: {csv_file.name}")
        continue

    data[elephant] = {}
    row_count = 0

    with open(csv_file, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                x_m   = float(row['x_m']) if 'x_m' in row else float(row['x']) * 1000
                y_m   = float(row['y_m']) if 'y_m' in row else float(row['y']) * 1000
                beh   = row.get('behavior', '').strip().lower()
                stage = row.get('Stage', row.get('stage', '')).strip().lower()
            except (ValueError, KeyError):
                continue

            beh_key   = BEHAVIOR_MAP.get(beh)
            stage_key = STAGE_MAP.get(stage)

            if not beh_key or not stage_key:
                continue

            if stage_key not in data[elephant]:
                data[elephant][stage_key] = {}
            if beh_key not in data[elephant][stage_key]:
                data[elephant][stage_key][beh_key] = []

            lat, lon = utm_to_latlon(x_m, y_m)
            # Basic sanity: Eastern Cape bounding box
            if -35 < lat < -32 and 25 < lon < 28:
                data[elephant][stage_key][beh_key].append([round(lat, 6), round(lon, 6)])
                row_count += 1

    print(f"  {elephant}: {row_count:,} points parsed")

# ── Downsample & write JSON ───────────────────────────────────────────────────
# Keep at most 4000 points per file (shuffled) for fast browser loading
import random
random.seed(42)
MAX_POINTS = 4000

files_written = 0
for elephant, periods in data.items():
    for period, behaviors in periods.items():
        for behavior, points in behaviors.items():
            if not points:
                continue
            # Downsample
            sample = random.sample(points, min(len(points), MAX_POINTS))
            out_path = OUT_DIR / f"{elephant}_{period}_{behavior}_heatmap.json"
            with open(out_path, 'w') as f:
                json.dump(sample, f, separators=(',', ':'))
            files_written += 1
            print(f"  [OK] {out_path.name}  ({len(sample):,} pts)")

print(f"\nDone. {files_written} heatmap JSON files written to {OUT_DIR}")
