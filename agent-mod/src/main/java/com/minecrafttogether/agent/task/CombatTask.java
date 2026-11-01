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
import net.minecraft.world.item.ShieldItem;
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
    private final java.util.List<String> priority;
    private final boolean useShield;

    private int kiteTicks = 0;
    private boolean shieldUp = false;

    /** 盾で受ける価値のある遠距離系 (盾運用の判定用) */
    private static final java.util.Set<String> RANGED_TYPES = java.util.Set.of(
        "minecraft:skeleton", "minecraft:stray", "minecraft:witch",
        "minecraft:pillager", "minecraft:blaze", "minecraft:drowned",
        "minecraft:evoker", "minecraft:piglin");

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
        this(id, entityId, types, anchorEntityId, anchorPos, leash,
            maxSeconds, hpAbort, java.util.List.of(), false);
    }

    public CombatTask(String id, Integer entityId, Set<String> types,
                      Integer anchorEntityId, Vec3 anchorPos,
                      double leash, int maxSeconds, float hpAbort,
                      java.util.List<String> priority, boolean useShield) {
        super(id);
        this.entityId = entityId;
        this.types = types;
        this.anchorEntityId = anchorEntityId;
        this.anchorPos = anchorPos;
        this.leash = leash;
        this.maxTicks = Math.max(20, Math.min(maxSeconds, 300) * 20);
        this.hpAbort = hpAbort;
        this.priority = priority;
        this.useShield = useShield;
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null || mc.level == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        IBaritone b = GotoTask.baritone();
        if (b == null) { fail("UNSUPPORTED", "baritone not available"); return; }

        if (state == State.CANCELLING) {
            setShield(mc, false);
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
        String targetType = BuiltInRegistries.ENTITY_TYPE
            .getKey(target.getType()).toString();
        if (kiteTicks > 0) kiteTicks--;
        if (dist > reach + 0.6) {
            // 接近中: 遠距離敵相手なら盾を構える (歩行は遅くなる)
            setShield(mc, useShield && hasShield(p)
                && RANGED_TYPES.contains(targetType));
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
        // クリーパーを殴った直後は下がる (爆発回避のカイト)
        if (kiteTicks > 0 && targetType.equals("minecraft:creeper")) {
            setShield(mc, false);
            Vec3 away = p.position().subtract(target.position());
            away = new Vec3(away.x, 0, away.z);
            if (away.lengthSqr() < 0.01) away = new Vec3(1, 0, 0);
            away = away.normalize().scale(4.5);
            BlockPos flee = BlockPos.containing(
                p.position().add(away));
            b.getCustomGoalProcess().setGoalAndPath(new GoalNear(flee, 1));
            pathing = true;
            return;
        }
        stopPathing(b);
        if (p.getAttackStrengthScale(0.0f) >= 0.95f) {
            setShield(mc, false);
            mc.gameMode.attack(p, target);
            p.swing(InteractionHand.MAIN_HAND);
            hits++;
            hitsOnCurrent++;
            if (targetType.equals("minecraft:creeper")) kiteTicks = 12;
            if (target.isDeadOrDying() || target.getHealth() <= 0) {
                kills++;
                currentTargetId = -1;
                lastGoalPos = null;
            }
        } else {
            // クールダウン中は盾で受ける
            setShield(mc, useShield && hasShield(p));
        }
    }

    private boolean hasShield(LocalPlayer p) {
        return p.getOffhandItem().getItem() instanceof ShieldItem;
    }

    private void setShield(Minecraft mc, boolean up) {
        if (up == shieldUp) return;
        shieldUp = up;
        mc.options.keyUse.setDown(up);
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
        // 優先順位 (D46): 指定種別を順に最寄りで探し、最初に
        // 見つかった種別を狙う (例: クリーパー → 子ゾンビ → 他)
        if (!priority.isEmpty()) {
            for (String pt : priority) {
                LivingEntity pb = null;
                double pd = Double.MAX_VALUE;
                for (Entity e : mc.level.entitiesForRendering()) {
                    if (e == p || !(e instanceof LivingEntity le) || !le.isAlive()) continue;
                    if (anchorEntityId != null && e.getId() == anchorEntityId) continue;
                    String tid = BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString();
                    if (!tid.equals(pt) || !types.contains(tid)) continue;
                    double d = p.distanceToSqr(e);
                    if (d < pd) { pd = d; pb = le; }
                }
                if (pb != null) return pb;
            }
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
        Minecraft mc = Minecraft.getInstance();
        if (mc != null) setShield(mc, false);
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
