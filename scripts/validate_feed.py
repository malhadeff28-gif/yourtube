#!/usr/bin/env python3
"""Validate a candidate YourTube feed before an atomic replacement."""
import json, re, sys
from pathlib import Path
from datetime import datetime
p=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'dist/feed.json'
data=json.loads(p.read_text())
assert isinstance(data.get('contexts'),list) and isinstance(data.get('videos'),list)
assert isinstance(data.get('contextSource'),str) and len(data['contextSource']) <= 500
assert datetime.fromisoformat(data['updatedAt'].replace('Z','+00:00')).tzinfo
contexts=set()
for c in data['contexts']:
    assert isinstance(c,dict) and re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',c['id']) and c['id'] not in contexts
    contexts.add(c['id'])
    for k,limit in [('name',90),('task',400),('note',300)]: assert isinstance(c.get(k,''),str) and len(c.get(k,''))<=limit
    assert c['name'].strip() and c['task'].strip()
ids=set()
for v in data['videos']:
    assert re.fullmatch(r'[a-zA-Z0-9_-]{11}',v['id']) and v['id'] not in ids and v['context'] in contexts
    ids.add(v['id'])
    for k,limit in [('title',200),('channel',100),('reason',300),('source',150)]: assert isinstance(v.get(k),str) and 0<len(v[k].strip())<=limit
print(f'Valid feed: {len(contexts)} projects, {len(ids)} videos')
