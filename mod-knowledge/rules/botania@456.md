# Botania 456 (1.20.1) — layer-3 notes (AI consumer)

Provenance: VazkiiMods/Botania, tag release-1.20.1-456,
commit 361ddf3e2142047ff57e3c5c2dc6de617d7a0b55. Values file:
botania@456.json (same directory). Repo layout note: common
code lives under Xplat/src/main/java; the Forge jar is built
from Xplat + Forge modules.

## Mana storage and transport (operational model)

- rule mana_pool_capacity: pool = 1000000 mana; diluted pool
  = 10000 mana (visual/storage miniature only); mana tablet =
  500000 mana (half a pool).
- rule spreader_variants: burst sizes are mana/redstone 160,
  elven 240, gaia 640 mana per shot. Buffers: 1000 mana
  (gaia 6400). A spreader fires only when its buffer holds at
  least one full burst.
- rule burst_loss_model: bursts are lossless for the first
  60 ticks (elven 80, gaia 120), then bleed 4 mana/tick
  (gaia 20 mana/tick). Design consequence: place pools and
  consumers within the lossless flight window; gaia spreaders
  are for short fat pipes, not distance.

## Generation (verified flowers)

- rule endoflame_generation: 1.5 mana/tick while burning;
  total per fuel = (burn time / 2) x 1.5 (coal = 1200 mana).
- rule hydroangeas_generation_and_decay: 40 mana per water
  block, and the flower DIES after 72000 ticks (60 minutes)
  leaving a dead bush. Hydroangeas farms are consumables,
  not permanent infrastructure.
- rule thermalily_generation: 27000 mana per lava block
  (45 mana/tick x 600 ticks), before its post-burn cooldown.
- rule gourmaryllis_generation: food value squared scaling
  with a variety streak up to x1.8; feeding it one repeated
  food is the worst use. Max single food = 18144 mana.
- rule entropinnyum_buffer: one TNT conversion is capped by
  the 6500 mana buffer; chain multiple flowers for mass TNT.

## Crafting gates

- rule terrasteel_cost: terrasteel ingot = 500000 mana on the
  terra plate (half a pool) plus manasteel ingot, mana pearl,
  mana diamond. Recipe is jar datapack data; packs may change
  it.

## Not read in this pass

Alfheim portal upkeep and elven trade rates, runic altar and
petal apothecary costs (recipe data, layer 1), functional
flower radii and rates (per-flower classes), sparks and
corporea, Gaia Guardian fight numbers, mana enchanter cost
model (relevant to the queued enchanting skill — read before
designing it).
