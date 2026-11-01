package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.phys.Vec3;

/**
 * 滑空タスク (D33): エリトラで目標点へ向けて姿勢 (yaw/pitch) を
 * tick 制御する。開始時点で空中にいることが前提 (離陸は呼び出し側)。
 */
public class GlideTask extends AgentTask {
    private final Vec3 target;
    private final int maxTicks;
    private int ticks = 0;
    private boolean wasAirborne = false;

    public GlideTask(String id, double x, double y, double z, int maxSeconds) {
        super(id);
        this.target = new Vec3(x, y, z);
        this.maxTicks = Math.max(40, Math.min(maxSeconds, 600) * 20);
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null || mc.level == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        if (state == State.CANCELLING) { state = State.CANCELLED; return; }
        ticks++;

        if (p.onGround()) {
            if (!wasAirborne && ticks > 10) {
                fail("ON_GROUND", "bot is on the ground; launch first");
                return;
            }
            if (wasAirborne) { finish("landed"); return; }
        } else {
            wasAirborne = true;
            if (!p.isFallFlying()) {
                try { p.startFallFlying(); } catch (Throwable ignored) { }
            }
        }
        if (ticks > maxTicks) { finish("timeout"); return; }

        Vec3 eye = p.getEyePosition();
        double dx = target.x - eye.x;
        double dy = target.y - eye.y;
        double dz = target.z - eye.z;
        double hDist = Math.hypot(dx, dz);
        double dist3 = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist3 < 5) { finish("arrived"); return; }

        float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
        double pitchDeg = Math.toDegrees(Math.atan2(-dy, Math.max(hDist, 0.001)));
        float pitch = (float) Math.max(-55, Math.min(25, pitchDeg));
        p.setYRot(yaw);
        p.setXRot(pitch);
    }

    private void finish(String reason) {
        JsonObject r = new JsonObject();
        r.addProperty("reason", reason);
        r.addProperty("ticks", ticks);
        result = r;
        state = State.SUCCEEDED;
    }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }

    @Override
    public void cancel() { state = State.CANCELLING; }
}
