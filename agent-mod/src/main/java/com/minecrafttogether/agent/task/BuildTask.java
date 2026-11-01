package com.minecrafttogether.agent.task;

import baritone.api.IBaritone;
import baritone.api.pathing.goals.GoalNear;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.commands.arguments.EntityAnchorArgument;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

/**
 * 建築タスク (D32): 絶対座標のブロック列を mod 側で消化する。
 * bridge の 1 ブロックごとの往復を置き換える。冪等 (設置済みは
 * skip)、在庫内のアイテム移動 (hotbar 選択 / main から swap) と
 * facing の立ち位置もタスク側で行う。検証は設置後の block state
 * 照合 (id + 指定 props) で行い、不一致は数えて次へ進む。
 */
public class BuildTask extends AgentTask {
    public record Placement(int x, int y, int z, String id, Map<String, String> props) {}

    private static final Map<String, Vec3> FACING_VEC = Map.of(
        "north", new Vec3(0, 0, -1), "south", new Vec3(0, 0, 1),
        "east", new Vec3(1, 0, 0), "west", new Vec3(-1, 0, 0));

    private final List<Placement> blocks;
    private final int maxTicks;
    private int ticks = 0;
    private int idx = 0;
    private int placed = 0;
    private int skipped = 0;
    private int mismatched = 0;
    private int failed = 0;
    private final List<JsonObject> mismatchedAt = new ArrayList<>();
    private final Set<String> missingItems = new LinkedHashSet<>();
    private boolean attempted = false;
    private int attemptTick = 0;
    private int blockStartTick = 0;
    private boolean pathing = false;
    private BlockPos lastGoal = null;

    public BuildTask(String id, List<Placement> blocks, int maxSeconds) {
        super(id);
        this.blocks = blocks;
        int auto = blocks.size() * 400 + 1200;
        this.maxTicks = Math.min(maxSeconds > 0 ? maxSeconds * 20 : auto, 20 * 3600);
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null || mc.level == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        IBaritone b = GotoTask.baritone();
        if (b == null) { fail("UNSUPPORTED", "baritone not available"); return; }
        if (state == State.CANCELLING) {
            stopPathing(b);
            state = State.CANCELLED;
            return;
        }
        ticks++;
        if (ticks > maxTicks) { finish(b, "timeout"); return; }
        if (idx >= blocks.size()) { finish(b, "done"); return; }

        Placement t = blocks.get(idx);
        BlockPos pos = new BlockPos(t.x(), t.y(), t.z());
        BlockState cur = mc.level.getBlockState(pos);

        if (attempted) {
            if (matches(cur, t)) { placed++; advance(); return; }
            if (ticks - attemptTick > 3) {
                mismatched++;
                if (mismatchedAt.size() < 10) {
                    JsonObject m = new JsonObject();
                    m.addProperty("x", t.x()); m.addProperty("y", t.y()); m.addProperty("z", t.z());
                    m.addProperty("id", t.id());
                    m.addProperty("actual", BuiltInRegistries.BLOCK.getKey(cur.getBlock()).toString());
                    mismatchedAt.add(m);
                }
                advance();
            }
            return;
        }
        if (matches(cur, t)) { skipped++; advance(); return; }
        // 既設の同 id で props だけ違う場合は mismatched として報告する
        if (!cur.isAir() && !t.props().isEmpty()
            && t.id().equals(BuiltInRegistries.BLOCK.getKey(cur.getBlock()).toString())) {
            mismatched++;
            if (mismatchedAt.size() < 10) {
                JsonObject m = new JsonObject();
                m.addProperty("x", t.x()); m.addProperty("y", t.y()); m.addProperty("z", t.z());
                m.addProperty("id", t.id());
                m.addProperty("actual", t.id());
                mismatchedAt.add(m);
            }
            advance();
            return;
        }
        // 別のブロックが占有している場所は勝手に壊さない (bridge v2 の規則)
        if (!cur.isAir() && !cur.canBeReplaced()) { failed++; advance(); return; }
        if (ticks - blockStartTick > 240) { failed++; advance(); return; }

        // アイテム確保
        var rl = ResourceLocation.tryParse(t.id());
        Block block = rl == null ? null : BuiltInRegistries.BLOCK.get(rl);
        if (block == null) { failed++; advance(); return; }
        Item item = block.asItem();
        if (item == Items.AIR) { missingItems.add(t.id()); advance(); return; }
        if (!ensureHeld(mc, p, item)) { missingItems.add(t.id()); advance(); return; }

        // facing 指定時は立ち位置を先に取る
        String facing = t.props().get("facing");
        if (facing != null && FACING_VEC.containsKey(facing)) {
            Vec3 stand = Vec3.atCenterOf(pos).add(FACING_VEC.get(facing));
            double dx = p.getX() - stand.x, dz = p.getZ() - stand.z;
            if (dx * dx + dz * dz > 1.7 || Math.abs(p.getY() - pos.getY()) > 1.5) {
                pathTo(b, new BlockPos((int) Math.floor(stand.x), pos.getY(), (int) Math.floor(stand.z)));
                return;
            }
        }

        // 射程
        Vec3 center = Vec3.atCenterOf(pos);
        if (p.getEyePosition().distanceToSqr(center) > 4.3 * 4.3) {
            pathTo(b, pos);
            return;
        }
        stopPathing(b);

        // 支持ブロックを探す (下→横→上)
        BlockPos support = null;
        Direction face = null;
        Direction[] order = { Direction.DOWN, Direction.NORTH, Direction.EAST,
                              Direction.SOUTH, Direction.WEST, Direction.UP };
        for (Direction d : order) {
            BlockPos n = pos.relative(d);
            if (!mc.level.getBlockState(n).isAir()) {
                support = n;
                face = d.getOpposite();
                break;
            }
        }
        if (support == null) { failed++; advance(); return; }

        p.lookAt(EntityAnchorArgument.Anchor.EYES, Vec3.atCenterOf(support));
        Vec3 hit = Vec3.atCenterOf(support).relative(face, 0.5);
        mc.gameMode.useItemOn(p, InteractionHand.MAIN_HAND,
            new BlockHitResult(hit, face, support, false));
        attempted = true;
        attemptTick = ticks;
    }

    private boolean matches(BlockState cur, Placement t) {
        if (!t.id().equals(BuiltInRegistries.BLOCK.getKey(cur.getBlock()).toString())) {
            return false;
        }
        if (t.props().isEmpty()) return true;
        Map<Property<?>, Comparable<?>> vals = cur.getValues();
        for (var e : t.props().entrySet()) {
            boolean ok = false;
            for (var ve : vals.entrySet()) {
                if (ve.getKey().getName().equals(e.getKey())) {
                    @SuppressWarnings({"rawtypes", "unchecked"})
                    String actual = ((Property) ve.getKey()).getName(ve.getValue());
                    ok = e.getValue().equals(actual);
                    break;
                }
            }
            if (!ok) return false;
        }
        return true;
    }

    private boolean ensureHeld(Minecraft mc, LocalPlayer p, Item item) {
        var inv = p.getInventory();
        if (inv.getSelected().is(item)) return true;
        for (int i = 0; i < 9; i++) {
            if (inv.getItem(i).is(item)) { inv.selected = i; return true; }
        }
        for (int i = 9; i < 36; i++) {
            if (inv.getItem(i).is(item)) {
                // InventoryMenu の main スロット番号は item index と一致する (9-35)
                mc.gameMode.handleInventoryMouseClick(
                    p.inventoryMenu.containerId, i, inv.selected, ClickType.SWAP, p);
                return inv.getSelected().is(item) || true;
            }
        }
        return false;
    }

    private void pathTo(IBaritone b, BlockPos pos) {
        if (!pathing || lastGoal == null || !pos.equals(lastGoal)) {
            b.getCustomGoalProcess().setGoalAndPath(new GoalNear(pos, 2));
            lastGoal = pos;
            pathing = true;
        }
    }

    private void stopPathing(IBaritone b) {
        if (pathing) {
            b.getPathingBehavior().cancelEverything();
            pathing = false;
            lastGoal = null;
        }
    }

    private void advance() {
        idx++;
        attempted = false;
        blockStartTick = ticks;
    }

    private void finish(IBaritone b, String reason) {
        stopPathing(b);
        JsonObject r = new JsonObject();
        r.addProperty("reason", reason);
        r.addProperty("placed", placed);
        r.addProperty("skipped", skipped);
        r.addProperty("mismatched", mismatched);
        r.addProperty("failed", failed);
        r.addProperty("remaining", blocks.size() - idx);
        JsonArray miss = new JsonArray();
        for (String s : missingItems) miss.add(s);
        r.add("missing_items", miss);
        JsonArray mm = new JsonArray();
        for (JsonObject o : mismatchedAt) mm.add(o);
        r.add("mismatched_at", mm);
        result = r;
        state = State.SUCCEEDED;
    }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }

    @Override
    public void cancel() { state = State.CANCELLING; }

    @Override
    protected void onPause() {
        IBaritone b = GotoTask.baritone();
        if (b != null) stopPathing(b);
    }
}
