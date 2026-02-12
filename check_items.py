import json
import re

d = json.load(open('data.json'))
print('data.json items per mode:', {k:len(v) for k,v in d['modes'].items()})

# Check HTML
with open('index.html') as f:
    html = f.read()
    
# Find allData JSON in HTML
match = re.search(r'const allData = (\{.*?\});', html, re.DOTALL)
if match:
    try:
        allData = json.loads(match.group(1))
        print('HTML allData items per mode:', {k:len(v) for k,v in allData.items()})
    except:
        print('Could not parse allData from HTML')
