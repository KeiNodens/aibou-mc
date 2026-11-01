# Enchanting Infuser 8.0.3 — layer-3 notes (AI consumer)

Provenance: Fuzss/enchanting-infuser, branch 1.20.1 tip,
commit cc13b7755daf8b72e53cd4de88680b5e4b5cafb0
(gradle.properties at this commit declares modVersion
8.0.3). Values file: enchantinginfuser@8.0.3.json.
All numbers are server config defaults (PuzzlesLib
config); a configured server may differ. This mod is the
pack's main candidate for the queued enchanting skill.

## Operating model (differs from the vanilla table)

- Every enchantment is directly selectable; there is no
  random offer roll and no lapis cost. Payment is XP
  levels only (rule xp_levels_only).
- rule bookshelf_power / power_thresholds: availability
  is bookshelf-gated by rarity: rare appears at 6 of 15
  shelves and maxes at 12; very rare needs 60% power to
  appear and full power to max. A station build target is
  the full 15 shelves; partial shelves silently cap the
  enchantment levels offered.
- rule cost_scaling_model: the price of a full maxed item
  is normalized to 30 levels (normal) or 20 (advanced);
  individual enchantments are weighted shares (rarity
  weights 2/3/4/5 per level). Quoting a price requires the
  whole target enchantment set, not one enchantment.
- rule treasure_availability: mending and other treasure
  enchantments are OFF by default in both infusers, and
  would need 95% power plus double price if enabled. Do
  not promise mending from this machine under default
  config.
- rule normal_vs_advanced (rules advanced_infuser_differences
  and normal_infuser_limits): the normal infuser cannot
  touch already-enchanted items, books, or repairs; the
  advanced infuser does all three and is cheaper at the
  cap. Automation should target the advanced infuser.
- rule repair_model: advanced repair restores 25%
  durability per step at multiplier 2 levels — a real
  alternative to anvil material repair for tools/armor.
- rule no_prior_work_penalty: infuser work does not raise
  anvil prior-work cost by default.

## For the future enchanting skill (design inputs)

The skill must: read the target item and desired
enchantments, verify bookshelf power around the placed
infuser (15 shelves for full range), check the operator's
XP level against the scaled total cost, drive the menu's
enchantment selection (GUI interaction — the menu exposes
per-enchantment level choices), and prefer the advanced
infuser block. Vanilla table and anvil flows remain
separate designs.

## Not read in this pass

Exact per-enchantment price shares inside EnchantmentUtil
(the scaling description in config is the contract used
here), Apotheosis compat adjustments, EMI/JEI integration.
