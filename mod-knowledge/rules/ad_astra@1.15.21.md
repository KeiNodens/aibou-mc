# Ad Astra 1.15.21 — layer-3 notes (AI consumer)

Provenance: terrarium-earth/Ad-Astra, branch 1.20.1 tip,
commit 5a986665e1d91e31c50321ff225a3fb23558ff35 (no tags;
gradle.properties at this commit declares 1.15.21).
Values file: ad_astra@1.15.21.json. Addon file:
ad_astra_giselle_addon@6.27.json (separate provenance).

## Flight model

- rule rocket_fuel: tank 3000 mB; a launch burns the whole
  tank on normal fuel, or 1000 mB on efficient fuel (3
  launches per tank). Budget fuel production accordingly.
- rule planet_tier_gating / planet_table_defaults: rocket
  tier gates destinations: T1 Moon, T2 Mars, T3 Venus and
  Mercury, T4 Glacio. Glacio is the only default planet
  with breathable air.
- rule rocket_crash_explosion: a crashed rocket explodes
  at 7 + 2 x tier power. Never test-land a high-tier rocket
  near the base.

## Survival model (applies to the bot as an entity)

- rule oxygen_damage: no oxygen + no full supplying suit =
  2 damage per environment application and forced air loss.
  The bot needs a full space suit set with charged oxygen
  tanks, or must stay inside oxygenated volumes (oxygen
  distributors) on every planet except Glacio and Earth.
- rule suit_oxygen_consumption: suit oxygen drains 1 unit
  per 12 ticks in unbreathable surroundings (1000 mB is
  about 10 minutes). Long surface excursions are tank
  logistics, not just distance.
- rule liveable_temperature_band / temperature_damage:
  outside -50..70 the planet itself attacks: Venus (464)
  and Mercury (167) burn for 6 plus fire; the Moon (-173)
  freezes for 3. Heat/freeze resistant full sets or the
  matching resistance are mandatory gear checks before
  launch, per destination.
- rule solar_power_by_planet: solar output is per-planet
  data (Mercury 64/tick, Moon 24, Glacio 14, Mars 12,
  Venus 8). Power plans do not transfer between planets.

## Not read in this pass

Machine energy costs and rates (config class), oxygen
distributor area and rate, fuel production chain numbers
(oil / fuel refining recipes are data), space station
construction costs, rover stats, boss and mob numbers
(Glacio), launch pad and structure rules.
