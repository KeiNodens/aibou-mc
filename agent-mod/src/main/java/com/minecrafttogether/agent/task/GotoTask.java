package com.minecrafttogether.agent.task;

import baritone.api.BaritoneAPI;
import baritone.api.IBaritone;
import baritone.api.pathing.goals.Goal;
import baritone.api.pathing.goals.GoalBlock;
import baritone.api.pathing.goals.GoalXZ;
import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;

/**
 * Baritone経路移動。customGoalProcess.setGoalAndPath で非同期に走り、
 * isActive() が外れたら終了判定: goal.isInGoal で成功/失敗を分ける。
 */
public class GotoTask extends AgentTask {
    private final Goal goal;
    private boolean started = false;

    /** D59/P2-7: 4引数版は y を常に明示として扱う。旧実装の
     *  y>=0 ヒューリスティクスでは、負 y の拠点 (地下基地) への
     *  退避が GoalXZ になり、地表に着いた時点で「到着」と
     *  誤認した。y 省略は5引数版で hasY=false を明示すること */
    public GotoTask(String id, int x, int y, int z) {
        this(id, x, y, z, true);
    }

    /** hasY distinguishes an omitted y from an explicit
     *  (possibly negative) y. Negative coordinates are real places
     *  (deepslate depths), not "no height given". */
    public GotoTask(String id, int x, int y, int z, boolean hasY) {
        super(id);
        this.goal = hasY ? new GoalBlock(new BlockPos(x, y, z)) : new GoalXZ(x, z);
    }

    @Override
    public boolean movementTask() { return true; }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        IBaritone b = baritone();
        if (b == null) { fail("UNSUPPORTED", "baritone not available"); return; }

        if (state == State.CANCELLING) {
            b.getPathingBehavior().cancelEverything();
            state = State.CANCELLED;
            return;
        }

        if (!started) {
            b.getCustomGoalProcess().setGoalAndPath(goal);
            started = true;
            return;
        }

        boolean active = b.getCustomGoalProcess().isActive() || b.getPathingBehavior().isPathing();
        if (active) return;

        BlockPos bp = p.blockPosition();
        if (goal.isInGoal(bp.getX(), bp.getY(), bp.getZ())) {
            JsonObject r = new JsonObject();
            r.addProperty("arrived", true);
            JsonObject pos = new JsonObject();
            pos.addProperty("x", p.getX());
            pos.addProperty("y", p.getY());
            pos.addProperty("z", p.getZ());
            r.add("pos", pos);
            result = r;
            state = State.SUCCEEDED;
        } else {
            fail("UNREACHABLE", "baritone stopped before reaching goal; est.remaining="
                + String.format("%.1f", goal.heuristic(bp.getX(), bp.getY(), bp.getZ())));
        }
    }

    @Override
    public void cancel() { state = State.CANCELLING; }

    @Override
    protected void onPause() {
        // 移動だけ止めてgoalは保持する。resumeで同じgoalへ再発行
        IBaritone b = baritone();
        if (b != null) b.getPathingBehavior().cancelEverything();
    }

    @Override
    protected void onResume() {
        IBaritone b = baritone();
        if (b != null) b.getCustomGoalProcess().setGoalAndPath(goal);
    }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }

    public static IBaritone baritone() {
        try { return BaritoneAPI.getProvider().getPrimaryBaritone(); }
        catch (Throwable t) { return null; }
    }
}
