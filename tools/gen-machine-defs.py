#!/usr/bin/env python3
"""発掘+プローブデータから machines/*.json 定義を生成する。
input: プローブのquick_move着地slot (実証) > slot_class推定
output: input以外の実slot (virtual/fuel除外)。未確定なら全実slotをpoll対象に
insert: quick_move着地実績があれば 'quick_move'、なければ 'direct'
"""
import json, glob, os, re

OUT = "machines"
os.makedirs(OUT, exist_ok=True)

def load(path):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return None

# family別のslot構造ヒント (input優先推定 -> output推定)
# (regex on menu_id, input_guess, output_guess, fuel, virtual_count)
HINTS = [
    (r"mekanism:(crusher|energized_smelter|enrichment_chamber|osmium_compressor|precision_sawmill)", [2], [3], None),
    (r"mekanism:combiner", [3], [4], None),
    (r"mekanism:metallurgic_infuser", [3], [4], None),
    (r"mekanism:factory$", None, None, None),  # tierで変わる — probe依存
    (r"mekanism:(purification_chamber|chemical_injection_chamber)", [2], [3], None),
    (r"mekanism:isotopic_centrifuge", [2], [3], None),
    (r"thermal:machine_(furnace|pulverizer|sawmill|smelter|insolator|centrifuge|press|crucible|chiller|refinery|pyrolyzer|bottler|brewer)", [0], [1], None),
    (r"enderio:(alloy_smelter|primitive_alloy_smelter)", [0,1,2], [3], None),
    (r"enderio:sag_mill", [0], [3,4], None),
    (r"enderio:enchanter", [0,1], [3], None),
    (r"enderio:wired_charger", [0], [1], None),
    (r"enderio:soul_binder", [0,1], [2], None),
    (r"enderio:slice_and_splice", [0,1,2,3,4,5], [6,7], None),
    (r"minecraft:brewing_stand", [3], [0,1,2], 4),
    (r"minecraft:(furnace|blast_furnace|smoker)", [0], [2], 1),
    (r"minecraft:smithing", [0,1,2,3], [4], None),
    (r"minecraft:hopper", [0,1,2,3,4], [], None),
    (r"minecraft:grindstone", [0,1], [2], None),
    (r"minecraft:stonecutter", [0], [1], None),
    (r"minecraft:loom", [0,1,2], [3], None),
    (r"minecraft:cartography", [0,1], [2], None),
    (r"minecraft:anvil", [0,1], [2], None),
    (r"minecraft:enchantment", [0,1], [], None),
    (r"minecraft:beacon", [0], [], None),
    (r"minecraft:shulker_box", list(range(27)), [], None),
    (r"ae2:inscriber", [0,1,2], [3], None),
    (r"ae2:charger", [0], [1], None),
    (r"ad_astra:compressor", [0,1,2,3,4,5,6,7,8], [9,10,11,12], 13),
    (r"ad_astra:etrionic_blast_furnace", [0,1,2], [3,4,5,6], None),
    (r"industrialforegoing|titanium:", None, None, None),  # probe依存
    (r"forestry:carpenter", [0,1,2,3,4,5,6,7,8], [9], None),
    (r"forestry:(squeezer|fermenter|moistener|fabricator)", [0], [1], None),
    (r"forestry:centrifuge", [0], [1], None),
    (r"forestry:bottler", [0], [1], None),
    (r"tofucraft:salt_furnace", [0], [2], 1),
    (r"twilightforest:cinder_furnace", [0], [2], 1),
    (r"projecte:(dm|rm)_furnace", [0,1,2,3,4,5,6,7], [9,10,11,12,13,14,15,16], None),
    (r"mna:disenchanter", [0,1], [2,3,4,5,6], None),
    (r"mysticalagriculture:enchanter", [0,1], [2], None),
    (r"immersiveengineering:alloy_smelter", [0,1], [2], None),
    (r"immersiveengineering:bottling_machine", [0], [1,2,3], None),
    (r"immersiveengineering:sawmill", [0,1], [2,3,4,5,6,7,8], None),
    (r"sakura:distiller", [0,1,2,3], [4,5,6,7], None),
    (r"sakura:fermenter", [0,1,2,3,4], [5,6,7,8], None),
    (r"tconstruct:seared_melter", [0,1,2,3], [], None),
    (r"ars_nouveau:imbuement_chamber", [0], [1], None),
    (r"botania:brewery", [0,1,2,3,4,5], [6], None),
    (r"mna:", [0], [1], None),
]

def roles_for(menu_id, machine_slots, probe_landed):
    classes = [s.get("cls","Slot") for s in machine_slots]
    real = [s["slot"] for s in machine_slots if "virtual" not in s.get("cls","").lower()]
    virtual = [s["slot"] for s in machine_slots if "virtual" in s.get("cls","").lower()]
    inp = out = fuel = None
    for pat, i, o, f in HINTS:
        if re.search(pat, menu_id):
            inp, out, fuel = i, o, f
            break
    if probe_landed:
        landed = [int(x) for x in probe_landed.split(",") if x != ""]
        if landed:
            inp = landed  # 実証を優先
    if inp is None:
        inp = real[:1]
    if out is None:
        out = [s for s in real if s not in inp]
    return inp, out, fuel, virtual, real

made = 0
for f in sorted(glob.glob("machines/discovery/*.json")):
    d = load(f)
    if not d:
        continue
    machine = d["machine"]
    menu = d.get("menu") or {}
    menu_id = menu.get("menu_id")
    if not menu_id or menu_id == "player_inventory":
        continue  # GUIが開かなかった (multiblock/要条件) は定義しない
    sizes = menu.get("container_sizes", {})
    if not sizes:
        continue
    player_cidx = max(sizes, key=lambda k: sizes[k])
    machine_slots = [s for s in menu["slots"] if str(s.get("container_idx")) != player_cidx]
    pf = os.path.join("machines/probe", os.path.basename(f))
    probe = load(pf) or {}
    landed = probe.get("landed") or ""
    inp, out, fuel, virtual, real = roles_for(menu_id, machine_slots, landed)
    d_def = {
        "menu_id": menu_id,
        "block": machine,
        "input": inp,
        "output": out,
    }
    if fuel is not None:
        d_def["fuel"] = [fuel] if isinstance(fuel, int) else fuel
    if virtual:
        d_def["virtual"] = virtual
    d_def["insert"] = "quick_move" if landed else "direct"
    d_def["verified_input"] = bool(landed)
    d_def["machine_slots"] = real
    out_path = os.path.join(OUT, f"{menu_id.replace(':','_')}.json")
    json.dump(d_def, open(out_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    made += 1
    print(f"{menu_id:60s} in={inp} out={out} insert={d_def['insert']}")
print(f"\n{made} defs written -> {OUT}/")
