package com.minecrafttogether.agent.task;

import baritone.api.IBaritone;
import baritone.api.pathing.goals.GoalNear;
import com.google.gson.JsonObject;
import java.util.Set;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.commands.arguments.EntityAnchorArgument;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.phys.Vec3;

/**
 * 戦闘タスク (D31): 対象への接近・照準・攻撃クールダウンに合わせた
 * 攻撃をクライアント tick で回す。「何を敵とみなすか」は呼び出し側の
 * 方針パラメータ (entity_id 指定 or types フィルタ) として受け取り、
 * タスク自体は力学に徹する。
 *
 * 終了理由 (result.reason): killed / cleared / no_target / target_gone /
 * timeout / low_hp / leash。戦績は kills / hits で返す。
 */
public class CombatTask extends AgentTask {
    private final Integer entityId;
    private final Set<String> types;
    private final Integer anchorEntityId;
    private final Vec3 anchorPos;
    private final double leash;
    private final int maxTicks;
    private final float hpAbort;

    private int ticks = 0;
    private int hits = 0;
    private int kills = 0;
    private int currentTargetId = -1;
    private int hitsOnCurrent = 0;
    private float lastTargetHealth = -1;
    private BlockPos lastGoalPos = null;
    private int sinceRepath = 0;
    private boolean pathing = false;

    public CombatTask(String id, Integer entityId, Set<String> types,
                      Integer anchorEntityId, Vec3 anchorPos,
                      double leash, int maxSeconds, float hpAbort) {
        super(id);
        this.entityId = entityId;
        this.types = types;
        this.anchorEntityId = anchorEntityId;
        this.anchorPos = anchorPos;
        this.leash = leash;
        this.maxTicks = Math.max(20, Math.min(maxSeconds, 300) * 20);
        this.hpAbort = hpAbort;
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

        if (hpAbort > 0 && p.getHealth() <= hpAbort) { finish(b, "low_hp"); return; }
        if (ticks > maxTicks) { finish(b, "timeout"); return; }

        // リーシュ: アンカーから離れすぎたら境界で止まる (失敗ではない)
        Vec3 anchor = resolveAnchor(mc);
        if (anchor != null && leash > 0
            && p.position().distanceToSqr(anchor) > leash * leash) {
            finish(b, "leash");
            return;
        }

        LivingEntity target = resolveTarget(mc, p);
        if (target == null) {
            stopPathing(b);
            if (entityId != null) {
                if (hits > 0) { countPossibleKill(); finish(b, "target_gone"); }
                else fail("NOT_FOUND", "target entity is gone: " + entityId);
            } else if (kills > 0) {
                finish(b, "cleared");
            } else if (ticks > 100) {
                finish(b, "no_target");
            }
            return;
        }
        if (target.getId() != currentTargetId) {
            currentTargetId = target.getId();
            hitsOnCurrent = 0;
            lastGoalPos = null;
        }
        lastTargetHealth = target.getHealth();

        // 照準
        p.lookAt(EntityAnchorArgument.Anchor.EYES, target.getEyePosition());

        double reach = p.getEntityReach();
        double dist = p.distanceTo(target);
        if (dist > reach + 0.6) {
            // 接近: 目標が動いた時だけ再パス (毎 tick は重い)
            sinceRepath++;
            BlockPos tp = target.blockPosition();
            if (!pathing || lastGoalPos == null || !tp.equals(lastGoalPos) || sinceRepath > 15) {
                b.getCustomGoalProcess().setGoalAndPath(new GoalNear(tp, 2));
                lastGoalPos = tp;
                sinceRepath = 0;
                pathing = true;
            }
            return;
        }
        stopPathing(b);
        if (p.getAttackStrengthScale(0.0f) >= 0.95f) {
            mc.gameMode.attack(p, target);
            p.swing(InteractionHand.MAIN_HAND);
            hits++;
            hitsOnCurrent++;
            if (target.isDeadOrDying() || target.getHealth() <= 0) {
                kills++;
                currentTargetId = -1;
                lastGoalPos = null;
            }
        }
    }

    private void countPossibleKill() {
        // 致命傷を与えた後に entity が消えた場合は kill と数える
        if (hitsOnCurrent > 0 && lastTargetHealth >= 0) kills++;
    }

    private Vec3 resolveAnchor(Minecraft mc) {
        if (anchorEntityId != null && mc.level != null) {
            Entity e = mc.level.getEntity(anchorEntityId);
            if (e != null) return e.position();
        }
        return anchorPos;
    }

    private LivingEntity resolveTarget(Minecraft mc, LocalPlayer p) {
        if (entityId != null) {
            Entity e = mc.level.getEntity(entityId);
            if (e instanceof LivingEntity le && le.isAlive()) return le;
            return null;
        }
        LivingEntity best = null;
        double bestD = Double.MAX_VALUE;
        for (Entity e : mc.level.entitiesForRendering()) {
            if (e == p || !(e instanceof LivingEntity le) || !le.isAlive()) continue;
            if (anchorEntityId != null && e.getId() == anchorEntityId) continue;
            String typeId = BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString();
            if (!types.contains(typeId)) continue;
            double d = p.distanceToSqr(e);
            if (d < bestD) { bestD = d; best = le; }
        }
        return best;
    }

    private void stopPathing(IBaritone b) {
        if (pathing) {
            b.getPathingBehavior().cancelEverything();
            pathing = false;
        }
    }

    private void finish(IBaritone b, String reason) {
        stopPathing(b);
        JsonObject r = new JsonObject();
        r.addProperty("reason", reason);
        r.addProperty("kills", kills);
        r.addProperty("hits", hits);
        r.addProperty("duration_ticks", ticks);
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
