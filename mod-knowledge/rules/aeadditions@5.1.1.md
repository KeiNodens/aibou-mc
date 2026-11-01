# AE2 addons (Wave 1 unit 8) — layer-3 notes (AI consumer)

Four small rule files, one per addon, plus one documented
gap. Base AE2 numbers are in ae2@15.4.11.json (D53).

## AEAdditions 5.1.1 — aeadditions@5.1.1.json
the9grounds/AE-Additions, tag 5.1.1, c562c03b.
Item cells jump to 1024k-65536k (up to 67108864 bytes and
300 types); fluid cells to 16384k with only 10-20 types.
For this pack's storage planning these replace AE2 cells
at the top end; watch the idle drain (up to 10 AE/t).

## AppliedE 0.14.3 — appliede@0.14.3.json
62832/AppliedE, branch 1.20.1 tip b57292fd (approximated
pin; see source_ref). EMC becomes an ME key type via a
Transmutation Module bound to a knowledge-provider
player; AE2 crafting can then spend the EMC pool.
Author-flagged early beta: powerful, keep the ProjectE
table as fallback. Combines with ProjectExpansion's
transmutation interface for endgame logistics.

## Applied Mekanistics 1.4.3 — applied_mekanistics@1.4.3.json
AppliedEnergistics/Applied-Mekanistics, tag 1.4.3,
7480d79c. Chemical cells reuse AE2 tiers but hold only
5 chemical types, and radioactive chemicals are refused
by cells entirely — Mekanism waste chains (D55 safety
context) stay out of ME storage.

## Applied Botanics 1.5.2 — applied_botanics@1.5.2.json
ramidzkh/Applied-Botanics, tag 1.5.2, 13791485.
Mana becomes ME-storable at 500 mana per byte: a 256k
mana cell holds 128,000,000 mana (128 pools). The fluix
mana pool bridges physical pools and the network.

## Documented gap: Applied Flux 1.3.7

The pack contains AppliedFlux-1.20-1.3.7-forge.jar (FE
storage for AE2). Its public source could NOT be located
(GitHub name/owner searches and the Modrinth source link
came up empty on 2026-11-01), so NO rule file is claimed
for it. If FE cell numbers are ever needed, extract them
from the jar itself (layer 2 route) or find the source
first. Do not quote FE cell capacities from memory.
