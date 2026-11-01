# ProjectE addons — layer-3 notes (AI consumer)

Two rule files: projectexpansion@1.1.3.json
(DonovanDMC/ProjectExpansion, branch 1.20.1 tip
4436aa664da9e26b63a47af9c3678631cace44b6) and
projecte_integration@7.2.5.json
(TagnumElite/ProjectE-Integration, branch 1.20.x tip
8ea22bc9ea940180f1bcbedd2197456512f2e1e2). Both extend
the base model in projecte@1.20.1-PE1.0.1.json (D52).

## ProjectExpansion (the EMC endgame of this pack)

- rule matter_tiers / collector_output_law / relay_law:
  16 matter tiers replace PE's MK1-3; every tier step
  multiplies collector output, relay bonus and relay
  transfer by 6. Planning a power flower or collector
  array is a tier decision, not a count decision: one
  tier up equals six of the tier below.
- rule final_relay_unlimited_transfer: only FINAL relays
  remove transfer bottlenecks entirely.
- rule star_capacities: PX stars start at 204,800,000 EMC
  (4x ProjectE's Klein Star Omega) and quadruple per step.
  Personal EMC storage stops mattering as a constraint
  early in the PX ladder.
- rule transmutation_interface: learned items present as
  infinite stock to AE2-style automation; the binding
  constraint is the EMC pool and generation rate, which is
  what the bot should monitor.
- rule operation_cadence / collector_multiplier_config:
  generation realizes in 20-tick steps and is globally
  scalable by config (default 1.0).

## ProjectE Integration (why modded items have EMC)

- rule mapper_coverage / pack_relevant_addons: 27 recipe
  mappers; 9 cover mods in this pack (AE2, Ars, Botania,
  Create, Farmer's Delight, IE, IF, Mana and Artifice,
  Mystical Agriculture). When a modded item shows an EMC
  value, this is usually why.
- rule values_stay_graph_computed: values remain
  graph-derived per the D52 model; a broken chain (a
  valueless ingredient) explains a missing EMC value
  better than a missing table entry.

## Not read in this pass

PX compressed collectors and power flower internals,
EMC Link tier behavior and vendor limits, Final gear and
tools, knowledge book sharing rules, PEI conversion
config files and per-addon mapper details beyond Botania.
