package com.minecrafttogether.agent.task;

import baritone.api.IBaritone;
import baritone.api.pathing.goals.GoalNear;
import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

/**
 * SLEEP_SYNC反射の実行体。bedへ近づき (Baritone GoalNear)、
 * 到着したらuseItemOnで就寝を試みる。非強制: 到達失敗・昼間拒否はそのまま終了。
 */
public class SleepTask extends AgentTask {
    private final BlockPos bed;
    private boolean started = false;
    private boolean tried = false;

    public SleepTask(String id, BlockPos bed) {
        super(id);
        this.bed = bed.immutable();
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        IBaritone b = GotoTask.baritone();
        if (b == null) { fail("UNSUPPORTED", "baritone not available"); return; }
        if (state == State.CANCELLING) {
            b.getPathingBehavior().cancelEverything();
            state = State.CANCELLED;
            return;
        }

        if (!started) {
            // 次元ガード (D44): ベッドが機能しない次元 (ネザー等)
            // では近づきもしない。DimensionType の性質で判定する
            // ので未知の次元にも効く (爆発事故の防止)
            if (!p.level().dimensionType().bedWorks()) {
                fail("DIMENSION", "beds do not work in this dimension");
                return;
            }
            b.getCustomGoalProcess().setGoalAndPath(new GoalNear(bed, 2));
            started = true;
            return;
        }
        if (!tried) {
            boolean active = b.getCustomGoalProcess().isActive()
                || b.getPathingBehavior().isPathing();
            if (active) return;
            if (!p.blockPosition().closerThan(bed, 4)) {
                fail("UNREACHABLE", "could not get near bed " + bed.toShortString());
                return;
            }
            var hit = new BlockHitResult(Vec3.atCenterOf(bed), Direction.UP,
                bed, false);
            var res = mc.gameMode.useItemOn(p, InteractionHand.MAIN_HAND, hit);
            JsonObject r = new JsonObject();
            r.addProperty("used_on", bed.toShortString());
            r.addProperty("result", res.toString().toLowerCase());
            result = r;
            tried = true;
            // 就寝判定はサーバー側 (昼間拒否も含め結果文字列は参考値)。試行完了で終了。
            state = State.SUCCEEDED;
            return;
        }
    }

    @Override
    public void cancel() { state = State.CANCELLING; }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }
}
