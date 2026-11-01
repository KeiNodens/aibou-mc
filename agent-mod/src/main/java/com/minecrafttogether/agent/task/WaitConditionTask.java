package com.minecrafttogether.agent.task;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;

/**
 * 条件待ちタスク (D32): 世界の状態が条件を満たすまで mod 側で待つ。
 * bridge のポーリング (world_craft の変換待ち、機械の出力待ち等) を
 * 置き換える汎用プリミティブ。条件は呼び出し側が宣言し、タスクは
 * 評価だけを行う。
 *
 * 条件 type:
 * - block {x,y,z,is?,is_not?}: その座標のブロック id
 * - entity_count {entity,center?,radius,cmp,count}: 範囲内の entity 数
 * - inventory {item,cmp,count}: bot の所持数
 * - menu_slots {slots:[int]}: 開いている menu の slot のいずれかが非空
 * cmp は gte / lte / eq。mode は all (既定) / any。
 */
public class WaitConditionTask extends AgentTask {
    private final JsonArray conditions;
    private final boolean anyMode;
    private final int maxTicks;
    private int ticks = 0;
    private boolean[] lastMet = new boolean[0];
    private final java.util.Map<Integer, Boolean> entityCache = new java.util.HashMap<>();

    public WaitConditionTask(String id, JsonArray conditions, String mode, int timeoutSeconds) {
        super(id);
        this.conditions = conditions;
        this.anyMode = "any".equals(mode);
        this.maxTicks = Math.max(20, Math.min(timeoutSeconds, 1800) * 20);
        this.lastMet = new boolean[conditions.size()];
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null || mc.level == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        if (state == State.CANCELLING) { state = State.CANCELLED; return; }
        ticks++;

        boolean all = true;
        boolean any = false;
        for (int i = 0; i < conditions.size(); i++) {
            boolean met = evaluate(mc, p, conditions.get(i).getAsJsonObject(), i);
            lastMet[i] = met;
            all &= met;
            any |= met;
        }
        if (anyMode ? any : all) { finish("met"); return; }
        if (ticks > maxTicks) finish("timeout");
    }

    private boolean evaluate(Minecraft mc, LocalPlayer p, JsonObject c, int idx) {
        try {
            String type = c.get("type").getAsString();
            switch (type) {
                case "block": {
                    BlockPos pos = new BlockPos(
                        c.get("x").getAsInt(), c.get("y").getAsInt(), c.get("z").getAsInt());
                    String id = BuiltInRegistries.BLOCK
                        .getKey(mc.level.getBlockState(pos).getBlock()).toString();
                    if (c.has("is") && !id.equals(c.get("is").getAsString())) return false;
                    if (c.has("is_not") && id.equals(c.get("is_not").getAsString())) return false;
                    return true;
                }
                case "entity_count": {
                    // 走査が重いので 4 tick に 1 回だけ再評価する
                    if (ticks % 4 != 0 && entityCache.containsKey(idx)) {
                        return entityCache.get(idx);
                    }
                    String want = c.get("entity").getAsString();
                    double r = c.has("radius") ? c.get("radius").getAsDouble() : 8;
                    double cx = p.getX(), cy = p.getY(), cz = p.getZ();
                    if (c.has("center")) {
                        JsonObject ctr = c.getAsJsonObject("center");
                        cx = ctr.get("x").getAsDouble();
                        cy = ctr.get("y").getAsDouble();
                        cz = ctr.get("z").getAsDouble();
                    }
                    int n = 0;
                    for (Entity e : mc.level.entitiesForRendering()) {
                        if (!want.equals(BuiltInRegistries.ENTITY_TYPE
                                .getKey(e.getType()).toString())) continue;
                        double dx = e.getX() - cx, dy = e.getY() - cy, dz = e.getZ() - cz;
                        if (dx * dx + dy * dy + dz * dz <= r * r) n++;
                    }
                    boolean met = cmp(n, c);
                    entityCache.put(idx, met);
                    return met;
                }
                case "inventory": {
                    var rl = ResourceLocation.tryParse(c.get("item").getAsString());
                    Item item = rl == null ? null : BuiltInRegistries.ITEM.get(rl);
                    if (item == null) return false;
                    int n = 0;
                    for (int i = 0; i < p.getInventory().getContainerSize(); i++) {
                        ItemStack st = p.getInventory().getItem(i);
                        if (st.is(item)) n += st.getCount();
                    }
                    return cmp(n, c);
                }
                case "menu_slots": {
                    if (p.containerMenu == null) return false;
                    for (var el : c.getAsJsonArray("slots")) {
                        int s = el.getAsInt();
                        if (s >= 0 && s < p.containerMenu.slots.size()
                            && p.containerMenu.getSlot(s).hasItem()) return true;
                    }
                    return false;
                }
                default:
                    return false;
            }
        } catch (Exception e) {
            return false;
        }
    }

    private boolean cmp(int n, JsonObject c) {
        int want = c.has("count") ? c.get("count").getAsInt() : 1;
        String cmp = c.has("cmp") ? c.get("cmp").getAsString() : "gte";
        return switch (cmp) {
            case "lte" -> n <= want;
            case "eq" -> n == want;
            case "ne" -> n != want;
            default -> n >= want;
        };
    }

    private void finish(String reason) {
        JsonObject r = new JsonObject();
        r.addProperty("reason", reason);
        r.addProperty("elapsed_ticks", ticks);
        JsonArray met = new JsonArray();
        for (boolean b : lastMet) met.add(b);
        r.add("met", met);
        result = r;
        state = State.SUCCEEDED;
    }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }

    @Override
    public void cancel() { state = State.CANCELLING; }
}
