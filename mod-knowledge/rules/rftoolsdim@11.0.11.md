# RFTools Dimensions — 11.0.11 — notes for the LLM

Source: McJtyMods/RFToolsDimensions @
df74542be396b52de8d58d47f86f5755b02544cc (branch `1.20`,
gradle.properties `version=1.20-11.0.11`). Machine-readable values:
`rftoolsdim@11.0.11.json`.

## Dimensions are an RF budget, not a build project

- **Creation**: the builder drains `10 + Σ(dimlet create)` RF per
  tick for `100 + Σ(dimlet ticks)` ticks. A modest tab is a few
  hundred RF/t for a few hundred ticks; a legendary-heavy tab is
  thousands per tick. Total creation energy ≈ the product — quote
  that, not a single "cost" number.
- **Upkeep is forever**: `10 + Σ(dimlet maintain)` RF/t, drawn from
  the dimension's own pool (20M–40M RF, sized by its upkeep).
  Lifetime when fully charged = pool ÷ upkeep — a 1,000 RF/t
  dimension lives ~7 hours on a 25M pool. Someone (or something)
  must keep feeding the builder with the tab, or the dimension
  starves. For a bot-tended base dimension, upkeep monitoring is a
  standing chore, like the fission reactor's 1200 K line.
- **Warnings** arrive at 12%, 9%, 2% and 1% of the pool — the 9%
  warning is the practical "refill now" line.
- **Zero power in this exact version (11.0.11)**: the classic
  instant-kill for powerless dimensions is *commented out* in the
  code. Phased-field-generator holders get slowness / mining
  fatigue / hunger instead. Don't tell the player they'll die —
  but don't design as if starvation were free either; machines and
  automation in an unpowered dimension are stranded until it's fed.

## Tab design rules of thumb

- Every material/fluid/attribute dimlet needs a consumer (terrain
  or feature) in the same tab, or creation fails with a DANGLING
  error — the tab editor is not just flavour, it's a type check.
- Unknown/random dimlets cost only 10% of their nominal upkeep
  (randomized cost factor) — random dimensions are cheap to *run*
  and expensive in *surprises*.
- Dimlet costs themselves are datapack JSON in the jar
  (dimletpackages, including per-mod packages for AE2, Mekanism,
  Botania, Tinkers, Thermal...), so a pack can rebalance them; when
  precision matters, read the live package data (layer 2) rather
  than assuming jar defaults.
- The admin "cheater" dimlet zeroes everything — if a tab contains
  one, the dimension was made in cheat mode; that's a conversation
  to have, not a recipe to copy.
