# Tinkers' Construct 3.12.1.231 — layer-3 notes (AI consumer)

Provenance: SlimeKnights/TinkersConstruct, tag v3.12.1.231,
commit a5a0324954f71b7620f766fadea0a0adf2984ae0. Values
file: tconstruct@3.12.1.231.json (same directory).

## Unit system (read this first)

- rule fluid_units: TiCon counts fluids in its own units:
  ingot = 90 mB, block = 810 mB, gem = 100 mB, glass block
  = 1000 mB. Any plan that moves fluids between TiCon and
  other mods (Mekanism, Thermal, Create) must convert;
  assuming 100 mB per ingot silently breaks ratios by 10%.

## Smeltery operation

- rule smeltery_capacity: tank capacity = 1080 mB per
  interior block. Size a smeltery by interior volume.
- rule smeltery_fuel_scaling: fuel burn rate grows by 1 per
  15 wall blocks; compact shells are cheaper to run.
- rule lava_fuel_data: lava gives 1000 degrees. Materials
  with melting temperature above the fuel temperature never
  melt, no matter how long they sit; check the melting
  recipe temperature against the fuel first.
- rule melting_recipe_data: melting time and temperature
  are per-item data (iron ingot: 800 degrees, 60 ticks).
- rule melter_capacity: the single-block melter holds
  2160 mB and melts one item at a time; use it for small
  batches and casts, not bulk.
- rule foundry_ore_rate: ores belong in the foundry
  variant, where per-recipe ore rates and byproducts apply;
  the plain smeltery wastes the bonus.

## Casting and materials

- rule alloying_is_data / casting_amounts_and_cooling_are_data
  / material_stats_are_data: alloy ratios, cast amounts,
  cooling times, and all tool material stats are datapack
  data shipped in the jar and commonly overridden by packs
  and addons (TicEX, Twilight Construct in this pack).
  Answer those questions from the pack's live extraction
  (layer 2), using these code rules only for the model:
  units, capacities, fuel scaling, temperature gating.

## Not read in this pass

Tool trait mechanics per material (data), modifier recipes
and slots (data + library code), tinker station and part
builder interactions, scorched vs seared structure rules,
slimeskull and gadget items, casting basin vs table slot
layouts (relevant to the D-audit's open smeltery GUI item —
 pair this file with the live GUI probe when it happens).
