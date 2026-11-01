package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.item.BowItem;
import net.minecraft.world.item.CrossbowItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.Vec3;

/**
 * 遠距離攻撃タスク (D44 基盤、D43 の基盤層): 弓/クロスボウを
 * 引いて狙って撃つ。照準は矢の物理 (初速・重力 0.05・抗力
 * 0.99) を反復シミュレーションして射角を解く。対象は
 * entity_id (追従して狙う) または固定座標 (クリスタル等)。
 * 射撃判断 (いつ・何を撃つか) は上位層、力学はここ。
 */
public class ShootTask extends AgentTask {
    private final Integer entityId;
    private final Vec3 fixedTarget;
    private final int maxShots;
    private final int maxTicks;
    private int t = 0;
    private int shots = 0;
    private int phase = 0; // 0=開始, 1=引き/照準中, 2=解放後クール
    private int phaseT = 0;
    private boolean sawTarget = false;

    public ShootTask(String id, Integer entityId, Vec3 fixedTarget,
            int maxShots, int maxSeconds) {
        super(id);
        this.entityId = entityId;
        this.fixedTarget = fixedTarget;
        this.maxShots = Math.max(1, Math.min(maxShots, 64));
        this.maxTicks = Math.max(20, Math.min(maxSeconds, 300) * 20);
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        if (state == State.CANCELLING) {
            mc.options.keyUse.setDown(false);
            state = State.CANCELLED;
            return;
        }
        if (++t > maxTicks) { finish("timeout"); return; }

        ItemStack hand = p.getMainHandItem();
        boolean bow = hand.getItem() instanceof BowItem;
        boolean crossbow = hand.getItem() instanceof CrossbowItem;
        if (!bow && !crossbow) {
            fail("NO_RANGED_WEAPON", "main hand holds no bow/crossbow");
            return;
        }

        Vec3 target = resolveTarget(mc, p);
        if (target == null) {
            mc.options.keyUse.setDown(false);
            finish(sawTarget || shots > 0 ? "target_gone" : "no_target");
            return;
        }
        sawTarget = true;

        switch (phase) {
            case 0 -> {
                // 矢の在庫確認 (infinity / creative は getProjectile が返す)
                if (p.getProjectile(hand).isEmpty()
                        && !p.getAbilities().instabuild) {
                    finish("out_of_arrows");
                    return;
                }
                if (crossbow && CrossbowItem.isCharged(hand)) {
                    // 装填済み: 照準して即発射
                    aim(p, target, 3.15);
                    mc.options.keyUse.setDown(true);
                    phase = 3;
                    phaseT = 0;
                    return;
                }
                aim(p, target, bow ? 3.0 : 3.15);
                mc.options.keyUse.setDown(true);
                phase = 1;
                phaseT = 0;
            }
            case 1 -> {
                aim(p, target, bow ? 3.0 : 3.15);
                int drawNeeded = bow ? 21 : 25;
                if (++phaseT >= drawNeeded) {
                    mc.options.keyUse.setDown(false);
                    shots++;
                    phase = 2;
                    phaseT = 0;
                }
            }
            case 3 -> { // 装填済みクロスボウの発射 (1tick 押して離す)
                if (++phaseT >= 2) {
                    mc.options.keyUse.setDown(false);
                    shots++;
                    phase = 2;
                    phaseT = 0;
                }
            }
            default -> { // phase 2: クールダウン
                if (++phaseT >= 8) {
                    if (shots >= maxShots) { finish("done"); return; }
                    phase = 0;
                    phaseT = 0;
                }
            }
        }
    }

    private Vec3 resolveTarget(Minecraft mc, LocalPlayer p) {
        if (entityId == null) return fixedTarget;
        if (mc.level == null) return null;
        Entity e = mc.level.getEntity(entityId);
        if (e == null || !e.isAlive()) return null;
        Vec3 c = e.getPosition(1.0f);
        return new Vec3(c.x, c.y + e.getBbHeight() * 0.65, c.z);
    }

    /**
     * 矢の飛翔をシミュレーションして最適な射角を求め、回転を適用。
     * 候補角を粗→密の2段で走査し、目標への最接近距離が最小の角を選ぶ。
     */
    private void aim(LocalPlayer p, Vec3 target, double speed) {
        Vec3 eye = p.getEyePosition();
        Vec3 d = target.subtract(eye);
        double yaw = Math.toDegrees(Math.atan2(-d.x, d.z));
        double bestPitch = 0;
        double bestMiss = Double.MAX_VALUE;
        for (double[] range : new double[][] {{-30, 60, 2.0}, null}) {
            double from = range == null ? bestPitch - 2 : range[0];
            double to = range == null ? bestPitch + 2 : range[1];
            double step = range == null ? 0.25 : range[2];
            for (double pitch = from; pitch <= to; pitch += step) {
                double miss = simulate(eye, yaw, pitch, speed, target);
                if (miss < bestMiss) { bestMiss = miss; bestPitch = pitch; }
            }
        }
        p.setYRot((float) yaw);
        p.setXRot((float) -bestPitch);
    }

    private double simulate(Vec3 eye, double yawDeg, double pitchDeg,
            double speed, Vec3 target) {
        double yaw = Math.toRadians(yawDeg);
        double pitch = Math.toRadians(pitchDeg);
        double vx = -Math.sin(yaw) * Math.cos(pitch) * speed;
        double vz = Math.cos(yaw) * Math.cos(pitch) * speed;
        double vy = Math.sin(pitch) * speed;
        double x = eye.x, y = eye.y, z = eye.z;
        double best = Double.MAX_VALUE;
        for (int i = 0; i < 100; i++) {
            x += vx; y += vy; z += vz;
            vx *= 0.99; vz *= 0.99; vy = vy * 0.99 - 0.05;
            double dx = x - target.x, dy = y - target.y, dz = z - target.z;
            double dist = dx * dx + dy * dy + dz * dz;
            if (dist < best) best = dist;
            if (y < target.y - 40) break;
        }
        return best;
    }

    private void finish(String reason) {
        Minecraft mc = Minecraft.getInstance();
        if (mc != null) mc.options.keyUse.setDown(false);
        // D59/P2-8: 1発も撃てなかった理由 (対象なし/矢なし) は失敗。
        // 旧実装は理由によらず SUCCEEDED で、虚偽成功になっていた
        if (shots == 0 && (reason.equals("no_target")
                || reason.equals("out_of_arrows"))) {
            fail(reason.equals("no_target") ? "NO_TARGET" : "OUT_OF_ARROWS",
                "no shot fired: " + reason);
            return;
        }
        JsonObject r = new JsonObject();
        r.addProperty("reason", reason);
        r.addProperty("shots", shots);
        result = r;
        state = State.SUCCEEDED;
    }

    @Override
    protected void onPause() {
        // D59/P2-8: 引き絞り中の pause は vanilla が矢を放つ = 実射撃。
        // その1発を shots に数え、フェーズを最初に戻して resume 後に
        // 再び引き絞らせる (旧実装はフェーズ据え置きで、resume 後に
        // 撃っていないのに shots++ だけが進んだ)
        Minecraft mc = Minecraft.getInstance();
        if (mc != null) mc.options.keyUse.setDown(false);
        if (phase == 1 || phase == 3) {
            shots++;
            phase = 0;
            phaseT = 0;
        }
    }

    @Override
    public void cancel() { state = State.CANCELLING; }

    private void fail(String code, String msg) {
        Minecraft mc = Minecraft.getInstance();
        if (mc != null) mc.options.keyUse.setDown(false);
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }
}
