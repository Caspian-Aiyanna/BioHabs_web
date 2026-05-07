import json

# ---- 1. behavioral_summaries.json (largest file, 1.5MB) ----
path = r'd:\PhD\website\iSSA\WEB\data\behavioral_summaries.json'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('"Sleeping"', '"Resting"')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('behavioral_summaries.json done')

# ---- 2. elephant_stats.json ----
path2 = r'd:\PhD\website\iSSA\WEB\data\elephant_stats.json'
with open(path2, 'r', encoding='utf-8') as f:
    content2 = f.read()

content2 = content2.replace('"Sleeping"', '"Resting"')

with open(path2, 'w', encoding='utf-8') as f:
    f.write(content2)
print('elephant_stats.json done')

# ---- 3. hmm_consolidated_stats.json ----
path3 = r'd:\PhD\website\iSSA\WEB\data\hmm_consolidated_stats.json'
with open(path3, 'r', encoding='utf-8') as f:
    content3 = f.read()

content3 = content3.replace('"Sleeping"', '"Resting"')
content3 = content3.replace('"Resting_LowEnergy"', '"Low-energy"')

with open(path3, 'w', encoding='utf-8') as f:
    f.write(content3)
print('hmm_consolidated_stats.json done')

# Verify
import re
print('\nVerification - any remaining Sleeping in json files:')
for p in [path, path2, path3]:
    with open(p, 'r', encoding='utf-8') as f:
        txt = f.read()
    count = txt.count('"Sleeping"')
    print(f'  {p.split(chr(92))[-1]}: {count} occurrences')
