#!/usr/bin/env bash
# 第2段: quick_move挿入プローブ。probe itemをquick_moveで機械に入れ、
# 実際に着地したslot番号を記録 -> input slotの実証特定。
# 出力: machines/probe/<modid>_<name>.json
cd "$(dirname "$0")/../bridge"
PX=${PX:--1}; PY=${PY:-63}; PZ=${PZ:--3}
OUT="../machines/probe"; mkdir -p "$OUT"
PROBE_ITEM="minecraft:cobblestone"

for f in ../machines/discovery/*.json; do
  m=$(python -c "import json;print(json.load(open(r'$f'))['machine'])" 2>/dev/null)
  [ -z "$m" ] && continue
  safe=$(echo "$m" | tr ':' '_')
  # probe itemを配布
  node mcp-call.mjs run_command "{\"command\":\"give Rin $PROBE_ITEM 1\"}" > /dev/null 2>&1
  sleep 0.2
  node mcp-call.mjs run_command "{\"command\":\"setblock $PX $PY $PZ $m replace\"}" > /dev/null 2>&1
  sleep 0.3
  node mcp-call.mjs look_at "{\"x\":$PX,\"y\":$((PY+1)),\"z\":$PZ}" > /dev/null 2>&1
  node mcp-call.mjs use_item "{\"x\":$PX,\"y\":$PY,\"z\":$PZ,\"face\":\"up\"}" > /dev/null 2>&1
  sleep 0.4
  menu=$(node mcp-call.mjs container_read '{}' 2>/dev/null)
  menu_id=$(echo "$menu" | python -c "import json,sys;print(json.load(sys.stdin).get('menu_id',''))" 2>/dev/null)
  [ -z "$menu_id" ] && { echo "$m -> no menu"; continue; }
  # player inv内のcobblestoneを探してquick_move
  src=$(echo "$menu" | python -c "
import json,sys
d=json.load(sys.stdin)
for s in d['slots']:
    if s.get('id')=='$PROBE_ITEM' and s['slot']>4:
        print(s['slot']); break
" 2>/dev/null)
  if [ -n "$src" ]; then
    node mcp-call.mjs container_click "{\"slot\":$src,\"action\":\"quick_move\"}" > /dev/null 2>&1
    sleep 0.3
  fi
  after=$(node mcp-call.mjs container_read '{}' 2>/dev/null)
  landed=$(echo "$after" | python -c "
import json,sys
d=json.load(sys.stdin)
sizes=d.get('container_sizes',{})
player_cidx = max(sizes, key=lambda k: sizes[k]) if sizes else '1'
out=[]
for s in d['slots']:
    if s.get('id')=='$PROBE_ITEM' and str(s.get('container_idx'))!=player_cidx:
        out.append(s['slot'])
print(','.join(map(str,out)))
" 2>/dev/null)
  echo "{\"machine\":\"$m\",\"menu_id\":\"$menu_id\",\"landed\":\"$landed\",\"src\":\"$src\",\"slots\":$(echo "$after" | python -c "import json,sys;d=json.load(sys.stdin);print(json.dumps([{'slot':s['slot'],'cidx':s.get('container_idx'),'cls':s.get('slot_class','Slot'),'id':s.get('id','')} for s in d['slots'][:8]]))" 2>/dev/null)}" > "$OUT/$safe.json"
  # 回収して閉じる
  [ -n "$landed" ] && node mcp-call.mjs container_click "{\"slot\":$(echo $landed | cut -d, -f1),\"action\":\"quick_move\"}" > /dev/null 2>&1
  node mcp-call.mjs container_close '{}' > /dev/null 2>&1
  node mcp-call.mjs run_command "{\"command\":\"setblock $PX $PY $PZ air replace\"}" > /dev/null 2>&1
  echo "$m -> landed=${landed:-stay}"
  sleep 0.2
done
echo "done -> $OUT"
