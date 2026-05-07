import pandas as pd
import json

df = pd.read_csv(r"D:\PhD\website\iSSA\results\Ecological_Behavior_V5\Elephant_Behavioral_Points_Final_V5.csv")

# Ensure timestamp is datetime
if 'timestamp' in df.columns:
    df['timestamp'] = pd.to_datetime(df['timestamp'], errors='coerce')
    df['hour'] = df['timestamp'].dt.hour
elif 'date' in df.columns:
    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df['hour'] = df['date'].dt.hour

# Seasonal Activity Budget
seasonal = df.groupby(['Season', 'behavior']).size().unstack(fill_value=0)
seasonal_pct = seasonal.div(seasonal.sum(axis=1), axis=0) * 100

# Daily (Diurnal vs Nocturnal)
# Let's say Day is 6:00 to 18:00, Night is 18:00 to 6:00
df['time_of_day'] = df['hour'].apply(lambda x: 'Day' if 6 <= x < 18 else 'Night')
daily = df.groupby(['time_of_day', 'behavior']).size().unstack(fill_value=0)
daily_pct = daily.div(daily.sum(axis=1), axis=0) * 100

# Consolidate
out = {
    "Seasonal": seasonal_pct.round(1).to_dict(orient="index"),
    "Daily": daily_pct.round(1).to_dict(orient="index")
}

print(json.dumps(out, indent=2))
