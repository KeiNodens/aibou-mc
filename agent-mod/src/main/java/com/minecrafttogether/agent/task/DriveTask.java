package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.Entity;

/**
 * 運転タスク (D33): 乗り物の制御席に座った状態で移動キーを保持し、
 * 速度を観測する。Create の列車が素のキー入力を読むかは実機未検証
 * (bridge 時代と同じ前提条件のまま、置き場所だけ mod に移した)。
 */
public class DriveTask extends AgentTask {
    private final boolean forward;
    private final int maxTicks;
    private int ticks = 0;
    private double maxSpeed = 0;

    public DriveTask(String id, boolean forward, int seconds) {
        super(id);
        this.forward = forward;
        this.maxTicks = Math.max(20, Math.min(seconds, 120) * 20);
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null || mc.level == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        if (state == State.CANCELLING) {
            releaseKeys(mc);
            state = State.CANCELLED;
            return;
        }
        ticks++;
        Entity v = p.getVehicle();
        if (v == null) {
            releaseKeys(mc);
            if (ticks <= 2) { fail("NOT_RIDING", "bot is not riding anything"); return; }
            finish("dismounted");
            return;
        }
        double sp = Math.max(v.getDeltaMovement().length(), reflectedSpeed(v));
        if (sp > maxSpeed) maxSpeed = sp;
        if (forward) mc.options.keyUp.setDown(true);
        else mc.options.keyDown.setDown(true);
        if (ticks >= maxTicks) {
            releaseKeys(mc);
            finish("done");
        }
    }

    private double reflectedSpeed(Entity vehicle) {
        try {
            Object con = vehicle.getClass().getMethod("getContraption").invoke(vehicle);
            if (con != null) {
                Object sp = con.getClass().getMethod("getSpeed").invoke(con);
                if (sp instanceof Number n) return Math.abs(n.doubleValue());
            }
        } catch (Throwable ignored) { }
        return 0;
    }

    private void finish(String reason) {
        JsonObject r = new JsonObject();
        r.addProperty("reason", reason);
        r.addProperty("max_speed", maxSpeed);
        r.addProperty("moved", maxSpeed > 0.05);
        r.addProperty("ticks", ticks);
        result = r;
        state = State.SUCCEEDED;
    }

    private void releaseKeys(Minecraft mc) {
        mc.options.keyUp.setDown(false);
        mc.options.keyDown.setDown(false);
    }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }

    @Override
    protected void onPause() {
        // Review S4: release the held movement keys, not just ticking.
        Minecraft mc = Minecraft.getInstance();
        if (mc != null) releaseKeys(mc);
    }

    @Override
    public void cancel() { state = State.CANCELLING; }
}
