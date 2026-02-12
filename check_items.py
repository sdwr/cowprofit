import json
d = json.load(open('data.json'))
print('data.json items per mode:', {k:len(v) for k,v in d['modes'].items()})
