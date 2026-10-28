#!/usr/bin/env bash
# 機械GUI構造の一括発掘。各ブロックをsetblock→open→container_read→closeして
# 結果を machines/discovery/<modid>_<name>.json に保存する。
# 前提: Rinがopでワールド内、PX/PY/PZに設置場所を指定できること。
cd "$(dirname "$0")/../bridge"
PX=${PX:--1}; PY=${PY:-63}; PZ=${PZ:--3}
OUT="../machines/discovery"; mkdir -p "$OUT"

MACHINES="
mekanism:crusher mekanism:energized_smelter mekanism:osmium_compressor
mekanism:combiner mekanism:purification_chamber mekanism:chemical_injection_chamber
mekanism:chemical_infuser mekanism:metallurgic_infuser mekanism:precision_sawmill
mekanism:isotopic_centrifuge mekanism:pressurized_reaction_chamber
mekanism:chemical_dissolution_chamber mekanism:chemical_oxidizer
mekanism:chemical_washer mekanism:electrolytic_separator
mekanism:solar_neutron_activator mekanism:nutritional_liquifier
mekanism:rotary_condensentrator mekanism:electric_pump
mekanism:formulaic_assemblicator mekanism:painting_machine
mekanism:basic_enriching_factory mekanism:advanced_smelting_factory
mekanism:elite_compressing_factory mekanism:ultimate_alloying_factory
evolvedmekanism:chemixer evolvedmekanism:laser_disenchanter
evolvedmekanism:solidification_chamber
thermal:machine_furnace thermal:machine_sawmill thermal:machine_pulverizer
thermal:machine_smelter thermal:machine_insolator thermal:machine_centrifuge
thermal:machine_press thermal:machine_crucible thermal:machine_chiller
thermal:machine_refinery thermal:machine_pyrolyzer thermal:machine_bottler
thermal:machine_brewer thermal:machine_crafter thermal:potion_infuser
thermal:device_soil_infuser thermal_extra:fluid_mixer
enderio:alloy_smelter enderio:primitive_alloy_smelter enderio:sag_mill
enderio:wired_charger enderio:enchanter enderio:crafter
enderio:slice_and_splice enderio:soul_binder
energizedpower:powered_furnace energizedpower:crusher energizedpower:pulverizer
energizedpower:sawmill energizedpower:alloy_furnace
energizedpower:induction_smelter energizedpower:charger
energizedpower:uncharger energizedpower:compressor
energizedpower:auto_crafter energizedpower:advanced_auto_crafter
energizedpower:advanced_powered_furnace energizedpower:advanced_crusher
energizedpower:advanced_pulverizer energizedpower:stone_solidifier
energizedpower:plant_growth_chamber
ae2:charger ae2:inscriber ae2:vibration_chamber
forestry:carpenter forestry:squeezer forestry:centrifuge forestry:fabricator
forestry:fermenter forestry:moistener forestry:bottler forestry:still
forestry:smelter
immersiveengineering:alloy_smelter immersiveengineering:bottling_machine
immersiveengineering:sawmill
ad_astra:compressor ad_astra:etrionic_blast_furnace
botania:brewery botania:enchanter
enchantinginfuser:enchanting_infuser enchantinginfuser:advanced_enchanting_infuser
ars_nouveau:imbuement_chamber mna:disenchanter
mysticalagriculture:enchanter projecte:dm_furnace projecte:rm_furnace
rftoolsbase:machine_infuser rftoolsutility:crafter1 rftoolspower:blazing_infuser
sakura:distiller sakura:fermenter tofucraft:salt_furnace
twilightforest:cinder_furnace tconstruct:seared_melter
industrialforegoing:dissolution_chamber industrialforegoing:material_stonework_factory
projectred_expansion:auto_crafter
minecraft:brewing_stand minecraft:grindstone minecraft:stonecutter
minecraft:loom minecraft:smithing_table minecraft:enchanting_table
minecraft:beacon minecraft:lectern minecraft:anvil
minecraft:cartography_table minecraft:shulker_box minecraft:hopper
minecraft:dispenser minecraft:dropper
"

for m in $MACHINES; do
  safe=$(echo "$m" | tr ':' '_')
  node mcp-call.mjs run_command "{\"command\":\"setblock $PX $PY $PZ $m replace\"}" > /dev/null 2>&1
  sleep 0.3
  node mcp-call.mjs look_at "{\"x\":$PX,\"y\":$((PY+1)),\"z\":$PZ}" > /dev/null 2>&1
  open=$(node mcp-call.mjs use_item "{\"x\":$PX,\"y\":$PY,\"z\":$PZ,\"face\":\"up\"}" 2>/dev/null)
  sleep 0.4
  read=$(node mcp-call.mjs container_read '{}' 2>/dev/null)
  echo "{\"machine\":\"$m\",\"open\":$open,\"menu\":$read}" > "$OUT/$safe.json"
  node mcp-call.mjs container_close '{}' > /dev/null 2>&1
  node mcp-call.mjs run_command "{\"command\":\"setblock $PX $PY $PZ air replace\"}" > /dev/null 2>&1
  menu_id=$(echo "$read" | python -c "import json,sys; print(json.load(sys.stdin).get('menu_id','?'))" 2>/dev/null)
  echo "$m -> ${menu_id:-fail}"
  sleep 0.2
done
echo "done -> $OUT"
