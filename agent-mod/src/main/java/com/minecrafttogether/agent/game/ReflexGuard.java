package com.minecrafttogether.agent.game;

import com.google.gson.JsonObject;
import com.minecrafttogether.agent.AgentMod;
import com.minecrafttogether.agent.net.AgentWsServer;
import com.minecrafttogether.agent.task.AgentTask;
import com.minecrafttogether.agent.task.GotoTask;
import com.minecrafttogether.agent.task.TaskManager;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.phys.AABB;

/**
 * 反射層 (LLM非依存の即時反応)。クライアントtickで被弾・敵接近を検知し、
 * 実行中タスクを INTERRUPTED で中断して reflex イベントを発火する。
 * 被弾時は脅威の逆方向へ Baritone離脱タスクを起こす。
 * reflex- 接頭辞のタスクは中断対象外 (離脱タスク自身を潰さないため)。
 */
public final class ReflexGuard {
    private static final double THREAT_RADIUS = 8.0;
    private static final int FLEE_DIST = 12;
    private static final int COOLDOWN_TICKS = 60;

    private static float lastHealth = -1;
    private static int cooldown = 0;

    private ReflexGuard() {}

    /** ClientTickEvent END から、TaskManager.tickAll の前に呼ぶ */
    public static void tick(Minecraft mc) {
        LocalPlayer p = mc.player;
        if (p == null || mc.level == null) { lastHealth = -1; return; }

        float hp = p.getHealth();
        boolean hurt = lastHealth >= 0 && hp < lastHealth;
        lastHealth = hp;

        if (cooldown > 0) { cooldown--; return; }

        Entity threat = nearestThreat(p);
        if (!hurt && threat == null) return;

        int interrupted = interruptTasks(threat, hurt);
        flee(p, threat, hurt);
        emitReflex(p, hurt, threat, interrupted);
        cooldown = COOLDOWN_TICKS;
    }

    private static Entity nearestThreat(LocalPlayer p) {
        AABB box = p.getBoundingBox().inflate(THREAT_RADIUS);
        Entity best = null;
        double bestD = Double.MAX_VALUE;
        for (Entity e : p.level().getEntities(p, box)) {
            if (!(e instanceof Monster)) continue;
            if (!e.isAlive()) continue;
            double d = e.distanceToSqr(p);
            if (d < bestD) { bestD = d; best = e; }
        }
        return best;
    }

    private static int interruptTasks(Entity threat, boolean hurt) {
        int n = 0;
        String reason = hurt
            ? "reflex: took damage"
            : "reflex: hostile within " + (int) THREAT_RADIUS + " blocks";
        for (AgentTask t : TaskManager.get().all()) {
            if (t.id.startsWith("reflex-")) continue;
            if (t.state == AgentTask.State.RUNNING
                || t.state == AgentTask.State.QUEUED) {
                t.errorCode = "INTERRUPTED";
                t.errorMessage = reason;
                t.cancel();
                n++;
            }
        }
        return n;
    }

    private static void flee(LocalPlayer p, Entity threat, boolean hurt) {
        if (GotoTask.baritone() == null) return;
        double dx = 0, dz = 0;
        if (threat != null) {
            dx = p.getX() - threat.getX();
            dz = p.getZ() - threat.getZ();
        }
        double len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.01) { dx = 1; len = 1; }
        int tx = (int) Math.floor(p.getX() + dx / len * FLEE_DIST);
        int tz = (int) Math.floor(p.getZ() + dz / len * FLEE_DIST);
        GotoTask t = new GotoTask(TaskManager.get().newId("reflex"), tx, -1, tz);
        TaskManager.get().register(t);
    }

    private static void emitReflex(LocalPlayer p, boolean hurt,
            Entity threat, int interrupted) {
        AgentWsServer ws = AgentMod.ws();
        if (ws == null) return;
        JsonObject ev = new JsonObject();
        ev.addProperty("type", hurt ? "hurt" : "threat_nearby");
        ev.addProperty("health", p.getHealth());
        ev.addProperty("interrupted", interrupted);
        if (threat != null) {
            ev.addProperty("entity",
                net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE
                    .getKey(threat.getType()).toString());
            ev.addProperty("entity_dist",
                Math.sqrt(threat.distanceToSqr(p)));
        }
        ws.emit("reflex", ev);
    }
}
