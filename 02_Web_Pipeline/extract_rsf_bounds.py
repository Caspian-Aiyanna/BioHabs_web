import os
import json
import rasterio
from rasterio.warp import transform_bounds

raster_dir = r"d:\PhD\website\iSSA\results\RSF\rasters"
bounds_dict = {}

# Leaflet expects [[south, west], [north, east]] i.e. [[min_lat, min_lon], [max_lat, max_lon]]
for period in ['pre', 'interim', 'post']:
    period_dir = os.path.join(raster_dir, period)
    if not os.path.exists(period_dir):
        continue
    for f in os.listdir(period_dir):
        if f.endswith('.tif') and f.startswith('Realized_'):
            # Only need bounding box for the PNGs which correspond to Realized_... or Usage_...
            # The PNGs are named Realized_RSF_E1_pre_Foraging.png, which correspond to Realized_E1_pre_Foraging.tif
            # wait, the PNG name is `Realized_RSF_E...` instead of `Realized_E...`
            path = os.path.join(period_dir, f)
            try:
                with rasterio.open(path) as src:
                    # Transform to WGS84 (EPSG:4326)
                    left, bottom, right, top = transform_bounds(src.crs, 'EPSG:4326', *src.bounds)
                    
                    # Leaflet bounds format
                    leaflet_bounds = [[bottom, left], [top, right]]
                    
                    # Create key from filename (without extension)
                    key = f.replace('.tif', '')
                    bounds_dict[key] = leaflet_bounds
            except Exception as e:
                print(f"Error processing {f}: {e}")

out_path = r"d:\PhD\website\iSSA\WEB\data\rsf_bounds.json"
with open(out_path, 'w') as out_f:
    json.dump(bounds_dict, out_f, indent=2)

print(f"Bounds extracted successfully to {out_path}")
