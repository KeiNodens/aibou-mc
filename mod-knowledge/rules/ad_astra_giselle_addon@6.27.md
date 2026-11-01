# Ad Astra Giselle Addon 6.27 — layer-3 notes (AI consumer)

Provenance: gisellevonbingen-Minecraft/Ad-Astra-Giselle-Addon,
branch 1.20.1-rework tip, commit
68925857c6519658d0bf1e2b21337f26ce0a08b2 (gradle.properties
at this commit declares mod_version 6.27, matching the
pack jar; the repo's tags stop at 6.9 and its plain 1.20.1
branch is stale, so this branch is the pin). Values file:
ad_astra_giselle_addon@6.27.json.

## What this addon adds (operational summary)

- rule fuel_loader: auto-fuels rockets within 2 blocks
  (buffer 8000, transfer 250). Together with the rocket
  sensor it makes launch pads hands-free.
- rule automation_nasa_workbench: the NASA workbench as an
  automatable machine (200 ticks per craft, energy-fed).
  Rocket production lines should use this, not the manual
  workbench.
- rule gravity_normalizer: powered area effect forcing
  Earth gravity; cost scales with volume at 0.5 energy per
  block, max length 31. Base-building tool for low-gravity
  planets (Moon 1.622).
- rule rocket_sensor: redstone on rocket presence within
  2 blocks.
- rule config_driven_values: every number above is a config
  default; verify against the live server config before
  quoting.

## Not read in this pass

Oxygen can and charging items in detail, flag and decal
content, enchantments added by the addon, jet suit hooks
into Ad Astra suits.
