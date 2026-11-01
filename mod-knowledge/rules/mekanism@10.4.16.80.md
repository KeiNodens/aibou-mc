# Mekanism — 10.4.16.80 — notes for the LLM

Source: mekanism/Mekanism @ 95b03e838aa94128596db42154a1527048372999
(tag `v1.20.1-10.4.16.80` — exactly the pack's Mekanism, Generators
and Additions jars; generators code is the repo's `src/generators`
module). Machine-readable values: `mekanism@10.4.16.80.json`.

## Fission: the numbers that keep the base alive

- **1200 K is the only line that matters.** Above it the reactor
  takes damage every tick: ~0.10/t at 1200 K (100% damage in about
  50 seconds), 0.15/t at 1800 K (about 33 seconds). Below 1200 K
  damage repairs, but slowly. There is no "grace zone" — cooling
  failures must be handled by automation, not by a player running
  over with a bucket.
- **Meltdown**: at 100% damage *and* still ≥1200 K, each tick rolls
  a 0.1% chance (config default) — expect it within roughly another
  minute. It is an explosion (radius 8 by default) **plus** a
  radiation release at 50× the contents' radioactivity. After a
  meltdown the reactor sits at 75% damage. If the server config
  disables meltdowns, the reactor instead force-stops until damage
  falls — check the config before promising either behavior.
- **SCRAM path**: the fission logic adapter has TEMPERATURE (≥1200 K)
  and DAMAGED redstone output modes. Any fission design the bot
  helps build should wire TEMPERATURE mode to stop the reaction —
  and any monitoring the bot does should treat 1200 K as a hard
  alarm. Never leave a running fission reactor unmonitored in a
  design the bot proposed.
- Burn rate: default 0.1 mB/t, maximum = fuel assemblies × 1 mB/t.
  More assemblies = more heat per tick = the cooling (sodium or
  water, plus turbine/boiler capacity) must be sized first.

## Fusion: patience, not danger

The plasma must reach **100,000,000 K** before fuel burns at all;
ignition is a laser energy problem (charge the laser amplifiers,
fire once), after which a sufficient injection rate (GUI cap
98 mB/t) keeps it self-sustaining. Fusion fails safe — a starved or
underheated plasma just cools down. The companion's job is fuel
logistics (deuterium/tritium supply), not emergency response.

## SPS: antimatter is a thousand-to-one conversion

Default config: **1 mB of antimatter costs 1000 mB of polonium
input and 1 GJ**. Antimatter is therefore the very end of the
fission → plutonium → polonium chain, and its production rate is
bounded by the fission waste pipeline, not by the SPS itself. Quote
these numbers only as defaults — both are server config values.
