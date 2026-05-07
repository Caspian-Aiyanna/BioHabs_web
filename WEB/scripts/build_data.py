"""
build_data.py

Master pipeline script to automate data preparation for the Elephant Movement Analysis web platform.
Run this script to sequentially generate all necessary web-friendly data formats (GeoJSON, PNG, Heatmap JSON) 
from the raw backend data.

Usage:
    python build_data.py
"""

import subprocess
import sys
import os
from pathlib import Path

def run_script(script_name, description):
    print(f"\n{'='*50}")
    print(f"[*] Starting: {description}")
    print(f"[*] Executing: {script_name}")
    print(f"{'='*50}\n")
    
    script_path = Path(__file__).parent / script_name
    
    if not script_path.exists():
        print(f"[!] ERROR: Script not found -> {script_path}")
        return False
        
    try:
        # Run the script and stream the output to the console
        result = subprocess.run(
            [sys.executable, str(script_path)],
            check=True,
            text=True
        )
        print(f"\n[+] SUCCESS: {script_name} completed.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"\n[!] ERROR: {script_name} failed with exit code {e.returncode}.")
        return False
    except Exception as e:
        print(f"\n[!] ERROR: An unexpected error occurred while running {script_name}: {e}")
        return False

def main():
    print("🐘 ELEPHANT MOVEMENT ANALYSIS - DATA BUILD PIPELINE 🐘")
    print("This pipeline orchestrates the conversion of raw data into web-friendly formats.")
    
    # 1. Shapefiles -> GeoJSON
    if not run_script("convert_shapefiles.py", "Converting Shapefiles to GeoJSON boundaries"):
        print("\n[!] Pipeline halted due to error in convert_shapefiles.py")
        sys.exit(1)
        
    # 2. RSF Rasters -> PNGs
    if not run_script("convert_rsf_rasters.py", "Converting RSF Rasters to Web-friendly PNG maps"):
        print("\n[!] Pipeline halted due to error in convert_rsf_rasters.py")
        sys.exit(1)
        
    # 3. Behavioral Points -> Heatmap JSONs
    if not run_script("generate_heatmap_json.py", "Generating Behavioral Heatmap JSON data"):
        print("\n[!] Pipeline halted due to error in generate_heatmap_json.py")
        sys.exit(1)
        
    print(f"\n{'='*50}")
    print("[🎉] PIPELINE COMPLETE: All data has been successfully processed!")
    print("The website data is now ready in the iSSA/WEB/data/ folder.")
    print(f"{'='*50}\n")

if __name__ == "__main__":
    main()
