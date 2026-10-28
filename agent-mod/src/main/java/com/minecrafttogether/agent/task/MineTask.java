package com.minecrafttogether.agent.task;

import baritone.api.IBaritone;
import com.google.gson.JsonObject;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;

/**
 * Baritone採集 (mineByName)。完了は isActive() の立ち下がり、
 * 成功判定は対象アイテムのインベントリ増加量で確認する。
 * mode: "additional" は新たにN個掘る、"ensure" は合計N個を目標に
 * 不足分だけ掘る (既に足りていれば即成功)。
 */
public class MineTask extends AgentTask {
    private final String blockName;
    private final int want;
    private final boolean ensureTotal;
    private boolean started = false;
    private int initialCount = -1;
    private int target = -1;
    private long lastProgressTick = -1;
    private int lastGot = -1;
    // 採取数が増えないままこのtick数経過したら諦める (Baritoneが
    // path不達のブラックリスト巡回で発散するケースの安全弁)
    private static final long STAGNANT_LIMIT = 6000; // 5分

    public MineTask(String id, String blockName, int want, boolean ensureTotal) {
        super(id);
        this.blockName = blockName;
        this.want = Math.max(1, want);
        this.ensureTotal = ensureTotal;
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        IBaritone b = GotoTask.baritone();
        if (b == null) { fail("UNSUPPORTED", "baritone not available"); return; }

        if (state == State.CANCELLING) {
            b.getMineProcess().cancel();
            b.getPathingBehavior().cancelEverything();
            state = State.CANCELLED;
            return;
        }

        if (!started) {
            if (initialCount < 0) {
                initialCount = countItems(p);
                target = ensureTotal ? Math.max(0, want - initialCount) : want;
                if (target == 0) {
                    JsonObject r = new JsonObject();
                    r.addProperty("block", blockName);
                    r.addProperty("wanted", want);
                    r.addProperty("held", initialCount);
                    r.addProperty("gathered", 0);
                    r.addProperty("already_satisfied", true);
                    result = r;
                    state = State.SUCCEEDED;
                    return;
                }
            }
            try {
                // mineByNameはバニラ短名しか解決できないため、レジストリから
                // Blockを直接解決して mine(Block...) に渡す (modブロック対応)。
                ResourceLocation rl = ResourceLocation.tryParse(blockName);
                if (rl == null || !BuiltInRegistries.BLOCK.containsKey(rl)) {
                    fail("BAD_REQUEST", "unknown block: " + blockName);
                    return;
                }
                var block = BuiltInRegistries.BLOCK.get(rl);
                b.getMineProcess().mine(block);
                started = true;
            } catch (Exception e) {
                fail("BAD_REQUEST", "mine rejected: " + e);
            }
            return;
        }

        int got = countItems(p) - initialCount;
        long now = mc.level != null ? mc.level.getGameTime() : 0;
        if (got != lastGot) { lastGot = got; lastProgressTick = now; }
        if (lastProgressTick >= 0 && now - lastProgressTick > STAGNANT_LIMIT) {
            b.getMineProcess().cancel();
            b.getPathingBehavior().cancelEverything();
            fail("TIMEOUT", "no progress for " + (STAGNANT_LIMIT / 20) + "s, gathered "
                + Math.max(0, got) + "/" + target);
            return;
        }
        if (got >= target) {
            b.getMineProcess().cancel();
            b.getPathingBehavior().cancelEverything();
            JsonObject r = new JsonObject();
            r.addProperty("block", blockName);
            r.addProperty("wanted", want);
            r.addProperty("held", initialCount + Math.max(0, got));
            r.addProperty("gathered", Math.max(0, got));
            result = r;
            state = State.SUCCEEDED;
            return;
        }

        boolean active = b.getMineProcess().isActive() || b.getPathingBehavior().isPathing();
        if (active) return;

        fail("UNREACHABLE",
            "baritone finished but only gathered " + got + "/" + target);
    }

    @Override
    public void cancel() { state = State.CANCELLING; }

    // ブロックとドロップアイテムのIDが違う代表的な対応。
    // クライアントにはloot tableが無いため近似 (silk touch等は考慮しない)
    private static final Map<String, String> DROP_ALIAS = Map.ofEntries(
        Map.entry("minecraft:stone", "minecraft:cobblestone"),
        Map.entry("minecraft:deepslate", "minecraft:cobbled_deepslate"),
        Map.entry("minecraft:grass_block", "minecraft:dirt"),
        Map.entry("minecraft:dirt_path", "minecraft:dirt"),
        Map.entry("minecraft:farmland", "minecraft:dirt"),
        Map.entry("minecraft:mycelium", "minecraft:dirt"),
        Map.entry("minecraft:podzol", "minecraft:dirt"),
        Map.entry("minecraft:diamond_ore", "minecraft:diamond"),
        Map.entry("minecraft:deepslate_diamond_ore", "minecraft:diamond"),
        Map.entry("minecraft:coal_ore", "minecraft:coal"),
        Map.entry("minecraft:deepslate_coal_ore", "minecraft:coal"),
        Map.entry("minecraft:iron_ore", "minecraft:raw_iron"),
        Map.entry("minecraft:deepslate_iron_ore", "minecraft:raw_iron"),
        Map.entry("minecraft:gold_ore", "minecraft:raw_gold"),
        Map.entry("minecraft:deepslate_gold_ore", "minecraft:raw_gold"),
        Map.entry("minecraft:copper_ore", "minecraft:raw_copper"),
        Map.entry("minecraft:deepslate_copper_ore", "minecraft:raw_copper"),
        Map.entry("minecraft:lapis_ore", "minecraft:lapis_lazuli"),
        Map.entry("minecraft:deepslate_lapis_ore", "minecraft:lapis_lazuli"),
        Map.entry("minecraft:redstone_ore", "minecraft:redstone"),
        Map.entry("minecraft:deepslate_redstone_ore", "minecraft:redstone"),
        Map.entry("minecraft:emerald_ore", "minecraft:emerald"),
        Map.entry("minecraft:deepslate_emerald_ore", "minecraft:emerald"),
        Map.entry("minecraft:nether_quartz_ore", "minecraft:quartz"),
        Map.entry("minecraft:nether_gold_ore", "minecraft:gold_nugget"),
        Map.entry("minecraft:glowstone", "minecraft:glowstone_dust"),
        Map.entry("minecraft:clay", "minecraft:clay_ball"),
        Map.entry("minecraft:snow_block", "minecraft:snowball"),
        Map.entry("minecraft:sea_lantern", "minecraft:prismarine_crystals"),
        Map.entry("minecraft:melon", "minecraft:melon_slice")
    );

    /** 採集対象として数えるアイテムID集合。ブロックID自身＋既知ドロップ＋mod鉱石ヒューリスティック */
    private Set<ResourceLocation> countableIds() {
        Set<ResourceLocation> ids = new HashSet<>();
        ResourceLocation base = ResourceLocation.tryParse(blockName);
        if (base != null) ids.add(base);
        String drop = DROP_ALIAS.get(blockName);
        if (drop != null) {
            ResourceLocation id = ResourceLocation.tryParse(drop);
            if (id != null) ids.add(id);
        }
        if (base != null && base.getPath().endsWith("_ore")) {
            String core = base.getPath()
                .replace("deepslate_", "")
                .replace("_ore", "");
            var wantPaths = Set.of("raw_" + core, core, core + "_shard",
                core + "_gem", core + "_crystal", core + "_fragment",
                core + "_dust");
            // namespace横断で探す (ad_astra:moon_iron_ore→minecraft:raw_iron
            // のようなクロスnamespaceドロップを拾うため、全idのpathを照合)
            for (ResourceLocation id : BuiltInRegistries.ITEM.keySet()) {
                if (wantPaths.contains(id.getPath())) ids.add(id);
            }
        }
        return ids;
    }

    private int countItems(LocalPlayer p) {
        Set<ResourceLocation> wantIds = countableIds();
        int n = 0;
        var inv = p.getInventory();
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack s = inv.getItem(i);
            if (s.isEmpty()) continue;
            ResourceLocation id = BuiltInRegistries.ITEM.getKey(s.getItem());
            if (id != null && wantIds.contains(id)) n += s.getCount();
        }
        return n;
    }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }
}
