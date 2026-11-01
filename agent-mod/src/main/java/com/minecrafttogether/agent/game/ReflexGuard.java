package com.minecrafttogether.agent.game;

import com.google.gson.JsonObject;
import com.minecrafttogether.agent.AgentConfig;
import com.minecrafttogether.agent.AgentMod;
import com.minecrafttogether.agent.net.AgentWsServer;
import com.minecrafttogether.agent.task.AgentTask;
import com.minecrafttogether.agent.task.CombatTask;
import com.minecrafttogether.agent.task.ShootTask;
import com.minecrafttogether.agent.task.EatTask;
import com.minecrafttogether.agent.task.GotoTask;
import com.minecrafttogether.agent.task.SleepTask;
import com.minecrafttogether.agent.task.TaskManager;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.block.BedBlock;
import net.minecraft.world.phys.AABB;

/**
 * 反射層 (LLM非依存の即時反応)。発火判定は ReflexPolicy (POJO) に分離。
 * 優先度: 溺死 > 退避(hp/敵数) > 食事 > 睡眠同期 > 死亡後帰還。
 * 被弾時の短距離逃走は従来どおり即時反応として維持。
 * reflex- 接頭辞のタスクは中断対象外 (反射タスク自身を潰さないため)。
 */
public final class ReflexGuard {
    private static final double THREAT_RADIUS = 8.0;
    private static final int FLEE_DIST = 12;
    private static final int COOLDOWN_TICKS = 60;
    private static final int BED_SCAN_RADIUS = 16;

    private static float lastHealth = -1;
    private static int cooldown = 0;
    private static boolean drowning = false;
    private static boolean wasDead = false;

    private static long lastEatAt = 0;
    private static long lastRetreatAt = 0;
    private static long lastSleepTryAt = 0;
    private static long lastReturnAt = 0;

    private ReflexGuard() {}

    /** ClientTickEvent END から、TaskManager.tickAll の前に呼ぶ */
    public static void tick(Minecraft mc) {
        LocalPlayer p = mc.player;
        if (p == null || mc.level == null) {
            lastHealth = -1;
            releaseJump(mc);
            return;
        }
        if (!AgentConfig.reflexEnabled()) {
            lastHealth = p.getHealth();
            releaseJump(mc);
            return;
        }
        long now = System.currentTimeMillis();

        float hp = p.getHealth();
        boolean hurt = lastHealth >= 0 && hp < lastHealth;
        boolean justRespawned = wasDead && hp > 0;
        wasDead = hp <= 0;
        lastHealth = hp;

        // 溺死回避はcooldownと独立して常時監視 (最優先)
        if (p.getAirSupply() < AgentConfig.reflexAirThreshold()) {
            if (!drowning) {
                drowning = true;
                emit(mc, p, "drown", null, 0);
            }
            mc.options.keyJump.setDown(true);
        } else if (drowning) {
            releaseJump(mc);
        }

        // policy発火判定
        ReflexPolicy.In in = new ReflexPolicy.In(
            hp, p.getFoodData().getFoodLevel(), p.getAirSupply(),
            countHostiles(p), isInHome(p), alreadyRetreating(),
            ownerSleeping(mc, p), anyUserTaskRunning(),
            justRespawned, AgentCapabilities.isOk("eat"),
            now, lastEatAt, lastRetreatAt, lastSleepTryAt, lastReturnAt,
            requestedCombatRunning());
        switch (ReflexPolicy.decide(in, cfg())) {
            case RETREAT -> { lastRetreatAt = now; retreat(mc, p); }
            case EAT -> { lastEatAt = now; eat(mc); }
            case SLEEP -> { lastSleepTryAt = now; sleep(mc, p); }
            case RETURN -> { lastReturnAt = now; returnHome(mc, p); }
            default -> {}
        }

        // 被弾・敵接近の即時逃走 (既存動作)。帰還中は攪乱しない。
        if (cooldown > 0) { cooldown--; return; }
        Entity threat = nearestThreat(p);
        if (!hurt && threat == null) return;
        if (alreadyRetreating()) return;
        // Review S2: requested combat (CombatTask/ShootTask) is intentional —
        // the threat closing in is the point. Combat tasks carry their own
        // hp_abort, so the reflex must not cancel them or flee mid-fight.
        if (requestedCombatRunning()) return;
        int interrupted = interruptTasks(threat, hurt);
        flee(p, threat, hurt);
        emitReflex(p, hurt, threat, interrupted);
        cooldown = COOLDOWN_TICKS;
    }

    private static ReflexPolicy.Cfg cfg() {
        return new ReflexPolicy.Cfg(
            AgentConfig.reflexAirThreshold(),
            AgentConfig.reflexRetreatHp(),
            AgentConfig.reflexRetreatHostiles(),
            AgentConfig.reflexRetreatCooldownMs(),
            AgentConfig.reflexEatFood(),
            AgentConfig.reflexEatCooldownMs(),
            AgentConfig.reflexSleepCooldownMs(),
            AgentConfig.combatDeathMode(),
            AgentConfig.reflexReturnAfterDeath());
    }

    private static void releaseJump(Minecraft mc) {
        drowning = false;
        mc.options.keyJump.setDown(false);
    }

    // ---- policy判定用の状態収集 ----

    private static int countHostiles(LocalPlayer p) {
        AABB box = p.getBoundingBox().inflate(THREAT_RADIUS);
        int n = 0;
        for (Entity e : p.level().getEntities(p, box)) {
            if (e instanceof Monster && e.isAlive()) n++;
        }
        return n;
    }

    private static boolean isInHome(LocalPlayer p) {
        return Waypoints.isWithin(AgentConfig.reflexHome(),
            p.getX(), p.getY(), p.getZ(), dimKey(p));
    }

    private static String dimKey(LocalPlayer p) {
        return p.level().dimension().location().toString();
    }

    private static boolean alreadyRetreating() {
        for (AgentTask t : TaskManager.get().all()) {
            if ((t.id.startsWith("reflex-home") || t.id.startsWith("reflex-return"))
                && (t.state == AgentTask.State.RUNNING
                    || t.state == AgentTask.State.QUEUED))
                return true;
        }
        return false;
    }

    private static boolean anyUserTaskRunning() {
        for (AgentTask t : TaskManager.get().all()) {
            if (t.id.startsWith("reflex-")) continue;
            if (t instanceof CombatTask || t instanceof ShootTask) continue;
            if (t.state == AgentTask.State.RUNNING
                || t.state == AgentTask.State.QUEUED) return true;
        }
        return false;
    }

    private static boolean ownerSleeping(Minecraft mc, LocalPlayer p) {
        String owner = AgentConfig.ownerName();
        for (Player pl : mc.level.players()) {
            if (pl == p) continue;
            if (!owner.isEmpty()
                && !pl.getGameProfile().getName().equalsIgnoreCase(owner)) continue;
            if (pl.isSleeping()) return true;
        }
        return false;
    }

    // ---- 発動アクション ----

    private static void retreat(Minecraft mc, LocalPlayer p) {
        Waypoints.Wp home = Waypoints.get(AgentConfig.reflexHome());
        if (home == null) {
            emit(mc, p, "retreat_no_home", null, 0);
            return;
        }
        GotoTask t = new GotoTask(TaskManager.get().newId("reflex-home"),
            home.x(), home.y(), home.z(), true);
        TaskManager.get().register(t);
        emit(mc, p, "retreat", null, 0);
    }

    private static void eat(Minecraft mc) {
        TaskManager.get().register(
            new EatTask(TaskManager.get().newId("reflex-eat")));
    }

    private static void sleep(Minecraft mc, LocalPlayer p) {
        BlockPos bed = findBed(p);
        if (bed == null) {
            emit(mc, p, "sleep_no_bed", null, 0);
            return;
        }
        TaskManager.get().register(
            new SleepTask(TaskManager.get().newId("reflex-sleep"), bed));
        emit(mc, p, "sleep", null, 0);
    }

    private static void returnHome(Minecraft mc, LocalPlayer p) {
        // 死亡→帰還: home優先、無ければ死亡地点
        Waypoints.Wp target = Waypoints.get(AgentConfig.reflexHome());
        if (target == null) target = Waypoints.get("_death");
        if (target == null) {
            emit(mc, p, "respawned", null, 0);
            return;
        }
        GotoTask t = new GotoTask(TaskManager.get().newId("reflex-return"),
            target.x(), target.y(), target.z(), true);
        TaskManager.get().register(t);
        JsonObject extra = new JsonObject();
        extra.addProperty("target", "home_or_death");
        emit(mc, p, "respawned", extra, 0);
    }

    /** 近傍のベッドを探す (SLEEP_SYNC試行時のみ走査、半径16) */
    private static BlockPos findBed(LocalPlayer p) {
        BlockPos c = p.blockPosition();
        BlockPos best = null;
        double bestD = Double.MAX_VALUE;
        for (BlockPos pos : BlockPos.betweenClosed(
                c.offset(-BED_SCAN_RADIUS, -BED_SCAN_RADIUS, -BED_SCAN_RADIUS),
                c.offset(BED_SCAN_RADIUS, BED_SCAN_RADIUS, BED_SCAN_RADIUS))) {
            if (p.level().getBlockState(pos).getBlock() instanceof BedBlock) {
                double d = pos.distSqr(c);
                if (d < bestD) { bestD = d; best = pos.immutable(); }
            }
        }
        return best;
    }

    // ---- 従来の被弾→短距離逃走 ----

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

    private static boolean requestedCombatRunning() {
        for (AgentTask t : TaskManager.get().all()) {
            if ((t instanceof CombatTask || t instanceof ShootTask)
                && (t.state == AgentTask.State.RUNNING || t.state == AgentTask.State.QUEUED)) {
                return true;
            }
        }
        return false;
    }

    private static int interruptTasks(Entity threat, boolean hurt) {
        int n = 0;
        String reason = hurt
            ? "reflex: took damage"
            : "reflex: hostile within " + (int) THREAT_RADIUS + " blocks";
        for (AgentTask t : TaskManager.get().all()) {
            if (t.id.startsWith("reflex-")) continue;
            if (t instanceof CombatTask || t instanceof ShootTask) continue;
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
        GotoTask t = new GotoTask(TaskManager.get().newId("reflex"), tx, -1, tz, false);
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

    /** 新反射系のイベント送出 (type可変・補足data任意) */
    private static void emit(Minecraft mc, LocalPlayer p, String type,
            JsonObject extra, int interrupted) {
        AgentWsServer ws = AgentMod.ws();
        if (ws == null) return;
        JsonObject ev = new JsonObject();
        ev.addProperty("type", type);
        ev.addProperty("health", p.getHealth());
        if (extra != null) for (String k : extra.keySet()) ev.add(k, extra.get(k));
        ws.emit("reflex", ev);
    }
}
