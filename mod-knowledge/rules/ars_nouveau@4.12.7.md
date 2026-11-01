# Ars Nouveau 4.12.7 — layer-3 notes (AI consumer)

Provenance: baileyholl/Ars-Nouveau, branch 1.20 tip,
commit 2c74064bc753600d9b6600f102f8163e2d6764dd (no tags
exist; build.gradle at this commit declares version
4.12.7). Values file: ars_nouveau@4.12.7.json.

## Source economy (operational model)

- rule source_jar_capacity: one jar holds 10000 source.
  All apparatus and imbuement work is budgeted against jars
  within range of the machine.
- rule sourcelink_buffer_and_transfer / source_relay:
  sourcelinks and relays buffer 1000 and transfer at 1000
  (alchemical link transfers 10000). Generation setups are
  throughput-limited by these rates, not by jar capacity.
- rule volcanic_sourcelink_feeding: volcanic links eat one
  dropped item per second within 1 block, or pedestal items
  around them. Item source values are data, not code.

## Player mana (the bot's casters use the same model)

- rule player_max_mana: max mana = 100 + 15 per glyph ever
  unlocked + 50 per book tier. Unlocking glyphs is permanent
  progression: a fresh caster has 100 mana; a full codex
  caster has several thousand.
- rule book_tier_is_sticky: holding an Archmage book once
  raises the player's tier permanently.
- rule player_mana_regen: regen = 5 + 0.33/glyph + 1/tier
  per second. Sustained casting rate is set by regen, burst
  rate by max mana.
- rule mana_config_is_server_side: all of these numbers are
  server config defaults.

## Casting and crafting gates

- rule spell_tiers: glyph tiers 1-3; book tier gates glyph
  tier and spell size (limit enforcement is config, default
  on). Spell mana cost is the sum of per-glyph costs defined
  in each glyph class (not extracted per glyph in this pass).
- rule apparatus_enchantment_source_costs: apparatus recipes
  state their source cost in recipe data (Mana Regen I =
  2000, II = 3500 source as shipped defaults). The bot's
  enchanting_apparatus station work must pre-position filled
  source jars; a recipe that will not start is usually a
  source-supply problem, not an ingredient problem.

## Not read in this pass

Per-glyph mana costs and tier assignments (glyph classes),
agronomic/mycelial/vitalic generation rates, imbuement
chamber rates, source gem and storage lectern mechanics,
rituals (brazier), turret costs, wilden and boss numbers.
