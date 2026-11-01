# Thermal suite (Wave 2 unit 1) — layer-3 notes (AI consumer)

Family: CoFH Thermal series, all version-locked by
walking each repo's 1.20.1 branch history to the last
commit of the pack's version window (no tags exist).

- thermal_expansion 11.0.1.29 — CoFH/ThermalExpansion
  fecc6f0. Config-wiring file (2 rules): every machine
  and dynamo rate is a server config "Base Power".
- thermal_foundation 11.0.6.70 — numbers live in
  CoFH/ThermalCore 9a9b4977 (11.0.6 state), bundled into
  the foundation jar; foundation repo pin 0e7b76ac.
  5 rules: manager base power 20 RF/t default
  (clamp 1..32000), dynamos 40 RF/t, fuel reference
  energies (magmatic/compression 100000, item dynamos
  16000), gourmand = nutrition x 1600 RF, pulverizer
  default recipe 4000 RF.
- thermal_dynamics 11.0.1.23 — CoFH/ThermalDynamics
  c748b5b1. 3 rules: energy limiter 64000 RF/t cap
  (32000/32000 defaults), fluid servo max 1000 mB per
  operation, and an absence finding: no hardcoded
  per-tier duct rates in this version's code.
- CoFH Core 11.0.2.56 also cached (single-commit
  version window, 6c9344a7) but produced no separate
  rule file; it is the shared library under the suite.

Not distilled (layer 2 / recipe data covers them):
thermal_cultivation (crops), thermal_innovation
(tools), thermal_integration (cross-mod recipes),
thermal_locomotion (rails), ThermalExtra 3.3.3,
thermalconstruct 0.0.5, Thermal's Delight (a Farmer's
Delight addon - belongs to the FD family unit).
Augment tier multipliers were not extracted in this
pass; read ThermalCore's augment registration before
quoting upgraded machine rates.
