import os
import pandas as pd
import json
import glob

csv_dir = r"d:\PhD\website\iSSA\WEB\data\behavioral_points"
all_files = glob.glob(os.path.join(csv_dir, "*_behavioral_points.csv"))

df_list = []
for f in all_files:
    try:
        df = pd.read_csv(f, low_memory=False)
        df_list.append(df)
    except Exception as e:
        print(f"Error reading {f}: {e}")

if not df_list:
    print("No data found")
    exit()

full_df = pd.concat(df_list, ignore_index=True)

# Clean up columns
full_df['Stage'] = full_df['Stage'].fillna(full_df.get('stage', full_df.get('STAGE', ''))).str.strip().str.upper()
full_df['Elephant'] = full_df['Elephant'].fillna(full_df.get('elephant', '')).str.strip().str.upper()

# Handle behavior
behavior_col = 'behavior' if 'behavior' in full_df.columns else ('Behavior' if 'Behavior' in full_df.columns else 'state')
full_df['behavior_clean'] = full_df[behavior_col].fillna('').str.strip()
full_df['behavior_clean'] = full_df['behavior_clean'].replace('Resting', 'Low-energy')

# Extract year, month, hour from date
full_df['date'] = pd.to_datetime(full_df['date'] if 'date' in full_df.columns else full_df['Date'])
if full_df['date'].dt.tz is None:
    full_df['date'] = full_df['date'].dt.tz_localize('UTC')
full_df['date_sast'] = full_df['date'].dt.tz_convert('Africa/Johannesburg')

full_df['year'] = full_df['date_sast'].dt.year
full_df['month'] = full_df['date_sast'].dt.month # 1 to 12
full_df['hour'] = full_df['date_sast'].dt.hour # 0 to 23

# We need Elephant (E1, E2...), Stage (PRE, INTERIM, POST), year, month, hour, behavior_clean -> count
grouped = full_df.groupby(['Elephant', 'Stage', 'year', 'month', 'hour', 'behavior_clean']).size().reset_index(name='count')

# Calculate metadata (date ranges and durations)
metadata = {}
meta_grouped = full_df.groupby(['Elephant', 'Stage'])
for name, group in meta_grouped:
    ele, stage = name
    min_d = group['date_sast'].min()
    max_d = group['date_sast'].max()
    duration = (max_d - min_d).days
    key = f"{ele}_{stage}"
    metadata[key] = {
        "min_date": min_d.strftime("%Y-%m-%d"),
        "max_date": max_d.strftime("%Y-%m-%d"),
        "duration": duration
    }

# To JSON array
records = grouped.to_dict(orient='records')
output_data = {
    "records": records,
    "metadata": metadata
}
out_path = r"d:\PhD\website\iSSA\WEB\data\behavioral_summaries.json"
with open(out_path, 'w') as f:
    json.dump(output_data, f)

print(f"Successfully generated {out_path} with {len(records)} aggregated records.")
