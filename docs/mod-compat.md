# Mod compatibility notes

Battle-tested notes from running this system on a 262-mod Forge 1.20.1 pack
(kitchen-sink style: AE2, Mekanism, Create, Ad Astra, Tinkers' Construct,
Farmer's Delight family, EMI/Jade, JourneyMap, etc.).

## Mods that must be removed or aligned on BOTH sides

These break either server boot, client boot, or the login handshake. All
details are field-verified; removing the mod is the current workaround unless
noted.

| Mod | Failure | Workaround |
|---|---|---|
| `sob` (Sun of a Beach?) | Built against Farmer's Delight 1.2.x; FD 1.3.4 removed `RoastChickenBlock` → CONSTRUCT crash | Remove both sides (no fixed release at time of writing) |
| `jeresources` + `jerintegration` | JER scans worldgen registries, crashes on unreferenced biome keys (`bamboomod:autumn_forest`) | Remove both sides (client-oriented JEI addon anyway) |
| `chunkpregen` | JourneyMap 6.x API break on client; also registers server-only command arg types → registry sync mismatch if missing on the other side | Remove both sides (world pre-generator, not needed for play) |
| `nolijium` | Client QoL mod; registers obfuscated handshake channels the server doesn't know → join rejected | Remove from bot/client |
| `arscurios` | **Adds an enum constant to `EquipmentSlot` via mixin** → TConstruct's fixed `UUID[6]` in `AttributeModule` overflows → `Invalid player data` on login. Known upstream bug, unfixed | Remove `arscurios` + dependent `slashnouveau` both sides |
| `slashnouveau` | Mandatory-depends on `arscurios` | Removed together |

## Mods that must exist on BOTH sides (easy to miss)

| Mod | Symptom when missing on server |
|---|---|
| `emi_loot` | Client registers channels `e_l:*`, `e_1:*` (shortened modid style used by fzzyhmstrs mods) → join rejected with "channel mismatch". Needs `fzzy_config` too. |
| `delightlib`, `bobo_lib`, `create_dragons_plus`, `farmersrespite` (+`respiteful`) | Plain missing-dependency aborts at early boot. Check `mods.toml` `mandatory` deps. |

## Known-pack data bugs worth patching

| Mod | Bug | Fix |
|---|---|---|
| `sugar_delight` | `sgushenka.json` recipe output uses `sugar_delight:sugar_delight:chocomilk` (double colon) → datapack load kills the server | Edit jar: output `sugar_delight:chocomilk`, fix malformed ingredients/tags to real IDs (`sugar_delight:c_ondensedmilk`) |

## Runtime quirks observed during bot play

| Mod | Behavior | Impact / workaround |
|---|---|---|
| `solapplepie` (Sol Sweet Potato) | `FoodTracker.onFoodEaten` throws `FoodListNotFoundException` ("Player must have food capability attached, but none was found") → server kicks the bot with `Internal server error` **every time it finishes eating**. The eat itself succeeds (hunger restored) and auto-rejoin recovers. | ~~Remove `solapplepie` server-side or accept kick+rejoin.~~ **Fixed in agent-mod** — `SolApplePieGuardMixin` marks the packet handled and swallows it when the capability isn't attached, so the mod stays in the pack (diversity buff intact). Requires the `solapplepie` jar in `agent-mod/libs/` at compile time. |
| `fastsuite` | Replaces `ServerPlaceRecipe` with a parallelized async implementation — recipe-book placement takes several ticks instead of 1 | Any packet-based crafting must wait ~20 ticks for the grid to fill. (`agent-mod` `CraftTask.PLACE_WAIT`) |
| `modernfix` | "Enhanced recipe sync" — lazy client recipe sync | Client recipe manager may only contain unlocked recipes early on; `recipe give <bot> *` resolves. |

## Flaky but retryable

- `urushi` dispenser registration races under parallel COMMON_SETUP (`fastutil` rehash `ArrayIndexOutOfBoundsException`). Restarting the server usually gets through. Not our code.
- `ticex` mixin injection warnings for SlashBlade are non-fatal.
- Model-loader warnings (`athena`, `ae2additions`, etc.) are resource noise, not blockers.

## Why a single-player pack can hide all of this

Integrated servers and Essential-style LAN sharing skip the dedicated-server
handshake (channel negotiation, registry sync, `Invalid player data` encode
path). Several of these failures only surface when a *dedicated* server meets
a *separate* client — i.e., exactly this architecture.
