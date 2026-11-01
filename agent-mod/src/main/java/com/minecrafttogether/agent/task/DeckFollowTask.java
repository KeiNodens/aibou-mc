package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.commands.arguments.EntityAnchorArgument;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;

/**
 * 甲板追従タスク (D33): 動くコントラプション上のローカル座標へ、
 * tick ごとにグローバル座標へ変換し直しながら素の移動入力で歩く。
 * Baritone は静的世界前提のため使わない。キーは終了時に必ず離す。
 */
public class DeckFollowTask extends AgentTask {
    private final Integer entityId;
    private final Vec3 local;
    private final int maxTicks;
    private int ticks = 0;

    public DeckFollowTask(String id, Integer entityId, Vec3 local, int maxSeconds) {
        super(id);
        this.entityId = entityId;
        this.local = local;
        this.maxTicks = Math.max(20, Math.min(maxSeconds, 300) * 20);
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
        Entity e = resolve(mc, p);
        if (e == null) { releaseKeys(mc); fail("CONTRAPTION_LOST", "contraption not found"); return; }
        if (p.getY() < e.getY() - 2.5) {
            releaseKeys(mc);
            fail("FELL_OFF_DECK", "bot fell below the deck");
            return;
        }
        Vec3 g = toGlobal(e, local);
        if (g == null) { releaseKeys(mc); fail("CONTRAPTION_LOST", "toGlobal failed"); return; }

        double dx = g.x - p.getX();
        double dz = g.z - p.getZ();
        double dist = Math.hypot(dx, dz);
        if (dist <= 0.8 && Math.abs(g.y - p.getY()) <= 1.4) {
            releaseKeys(mc);
            JsonObject r = new JsonObject();
            r.addProperty("arrived", true);
            r.addProperty("distance", dist);
            result = r;
            state = State.SUCCEEDED;
            return;
        }
        if (ticks > maxTicks) {
            releaseKeys(mc);
            fail("TIMEOUT", "deck follow timed out");
            return;
        }
        p.lookAt(EntityAnchorArgument.Anchor.EYES, g);
        mc.options.keyUp.setDown(true);
        mc.options.keyJump.setDown(g.y - p.getY() > 0.6);
    }

    private Entity resolve(Minecraft mc, LocalPlayer p) {
        if (entityId != null) {
            Entity e = mc.level.getEntity(entityId);
            return e != null ? e : null;
        }
        Entity best = null;
        double bd = Double.MAX_VALUE;
        for (Entity e : mc.level.entitiesForRendering()) {
            if (!e.getClass().getName().toLowerCase().contains("contraption")) continue;
            double d = p.distanceToSqr(e);
            if (d < bd) { bd = d; best = e; }
        }
        return best;
    }

    private Vec3 toGlobal(Entity entity, Vec3 in) {
        Object contraption = null;
        try {
            contraption = entity.getClass().getMethod("getContraption").invoke(entity);
        } catch (Throwable ignored) { }
        for (Object host : new Object[]{entity, contraption}) {
            if (host == null) continue;
            for (Class<?>[] sig : new Class<?>[][]{
                    {Vec3.class}, {Vec3.class, float.class}}) {
                try {
                    var m = host.getClass().getMethod("toGlobalVector", sig);
                    Object v = sig.length == 1 ? m.invoke(host, in) : m.invoke(host, in, 1.0f);
                    if (v instanceof Vec3 g) return g;
                } catch (Throwable ignored) { }
            }
        }
        return new Vec3(entity.getX() + in.x, entity.getY() + in.y, entity.getZ() + in.z);
    }

    private void releaseKeys(Minecraft mc) {
        mc.options.keyUp.setDown(false);
        mc.options.keyJump.setDown(false);
        mc.options.keySprint.setDown(false);
    }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }

    @Override
    public void cancel() { state = State.CANCELLING; }
}
