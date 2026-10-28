package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.protocol.game.ServerboundSetCarriedItemPacket;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/**
 * ブロック掘削。design §2.1 により直接 destroyBlock は使わず、
 * startDestroyBlock→continueDestroyBlock (毎tick) →stopDestroyBlock の
 * 通常入力経路を踏む。クリエイティブ以外はツール・距離の制約をそのまま受ける。
 */
public class DigTask extends AgentTask {
    private final BlockPos pos;
    private final Direction face;
    private int startedTicks = 0;
    private boolean started = false;
    private String lastBlock;

    public DigTask(String id, BlockPos pos, Direction face) {
        super(id);
        this.pos = pos;
        this.face = face;
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        MultiPlayerGameMode gm = mc.gameMode;
        if (p == null || gm == null || mc.level == null) {
            fail("NOT_IN_GAME", "player is not in a world");
            return;
        }

        if (state == State.CANCELLING) {
            gm.stopDestroyBlock();
            state = State.CANCELLED;
            return;
        }

        // 目標が既に空気なら完了扱い (直前に見えていたblock idを結果に残す)
        BlockState bs = mc.level.getBlockState(pos);
        if (!bs.isAir()) lastBlock = BuiltInRegistries.BLOCK.getKey(bs.getBlock()).toString();
        if (bs.isAir()) {
            JsonObject r = new JsonObject();
            r.addProperty("broken", true);
            r.addProperty("block", lastBlock != null ? lastBlock : "air");
            ItemStack held = p.getInventory().getSelected();
            if (!held.isEmpty()) {
                r.addProperty("tool",
                    BuiltInRegistries.ITEM.getKey(held.getItem()).toString());
            }
            result = r;
            state = State.SUCCEEDED;
            return;
        }

        // 到達距離チェック (目視線の先4.5m+余裕)
        double dist = p.getEyePosition().distanceTo(Vec3.atCenterOf(pos));
        if (dist > 6.0) {
            fail("OUT_OF_RANGE", "target is " + String.format("%.1f", dist) + "m away");
            return;
        }

        // 目標方向へ向ける
        Vec3 target = Vec3.atCenterOf(pos);
        p.lookAt(net.minecraft.commands.arguments.EntityAnchorArgument.Anchor.EYES, target);

        if (!started) {
            equipBestTool(p, bs);
            gm.startDestroyBlock(pos, face);
            started = true;
        }
        float progress = gm.continueDestroyBlock(pos, face) ? 1.0f : -1f;
        startedTicks++;
        if (startedTicks > 20 * 60) {
            gm.stopDestroyBlock();
            fail("TIMEOUT", "dig took too long");
        }
    }

    /**
     * 対象ブロックに対してホットバー最適ツールへ自動切替。
     * isCorrectToolForDrops を満たすツールを大きく優先するため、
     * 無充電の電動ツールや間違いtierのツールは自然に選ばれない。
     */
    private static void equipBestTool(LocalPlayer p, BlockState bs) {
        Inventory inv = p.getInventory();
        int sel = inv.selected;
        float cur = score(inv.getItem(sel), bs);
        int best = sel;
        float bestScore = cur;
        for (int i = 0; i < 9; i++) {
            if (i == sel) continue;
            float s = score(inv.getItem(i), bs);
            if (s > bestScore) { bestScore = s; best = i; }
        }
        if (best != sel) {
            inv.selected = best;
            p.connection.send(new ServerboundSetCarriedItemPacket(best));
        }
    }

    private static float score(ItemStack s, BlockState bs) {
        if (s.isEmpty()) return 0f;
        float v = s.getDestroySpeed(bs);
        // 適正ツール(ドロップを得られるもの)を速度より圧倒的に優先
        return s.isCorrectToolForDrops(bs) ? v + 100f : v;
    }

    @Override
    public void cancel() {
        // cancel受理時。game thread上なので直接停止処理できる
        state = State.CANCELLING;
    }

    private void fail(String code, String msg) {
        errorCode = code;
        errorMessage = msg;
        state = State.FAILED;
    }
}
