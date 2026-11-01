package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.projectile.FishingHook;

/**
 * 釣りタスク (D33): 投げる → 浮きの沈み込みでアタリ検知 → 合わせる、
 * を tick で回す。釣果の数え上げ (インベントリ差分) は bridge 側。
 * アタリ判定: 水中の浮きの y が直近の最大値から 0.12 以上急落した時。
 */
public class FishingTask extends AgentTask {
    private enum Phase { CAST, WAIT_HOOK, WAIT_BITE, REEL_WAIT }
    private final int maxCasts;
    private final int maxTicks;
    private Phase phase = Phase.CAST;
    private int ticks = 0;
    private int phaseTicks = 0;
    private int casts = 0;
    private int reels = 0;
    private int bites = 0;
    private double hookMaxY = Double.NEGATIVE_INFINITY;

    public FishingTask(String id, int maxCasts, int timeoutSeconds) {
        super(id);
        this.maxCasts = Math.max(1, Math.min(maxCasts, 100));
        this.maxTicks = Math.max(200, Math.min(timeoutSeconds, 1800) * 20);
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null || mc.level == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        if (state == State.CANCELLING) { state = State.CANCELLED; return; }
        ticks++;
        phaseTicks++;
        if (ticks > maxTicks) { finish("timeout"); return; }
        String held = BuiltInRegistries.ITEM.getKey(p.getMainHandItem().getItem()).toString();
        if (!"minecraft:fishing_rod".equals(held)) { finish("rod_gone"); return; }

        switch (phase) {
            case CAST -> {
                mc.gameMode.useItem(p, InteractionHand.MAIN_HAND);
                casts++;
                phase = Phase.WAIT_HOOK;
                phaseTicks = 0;
            }
            case WAIT_HOOK -> {
                if (p.fishing != null) {
                    phase = Phase.WAIT_BITE;
                    phaseTicks = 0;
                    hookMaxY = Double.NEGATIVE_INFINITY;
                } else if (phaseTicks > 30) {
                    // 投げ損ね: 次のキャストへ
                    if (casts >= maxCasts) { finish("casts_done"); return; }
                    phase = Phase.CAST;
                }
            }
            case WAIT_BITE -> {
                FishingHook hook = p.fishing;
                if (hook == null) { phase = Phase.REEL_WAIT; phaseTicks = 0; return; }
                double y = hook.getY();
                if (y > hookMaxY) hookMaxY = y;
                boolean bite = hook.isInWater() && hookMaxY > y + 0.12
                    && hook.getDeltaMovement().y < -0.03;
                if (bite) {
                    bites++;
                    mc.gameMode.useItem(p, InteractionHand.MAIN_HAND);
                    reels++;
                    phase = Phase.REEL_WAIT;
                    phaseTicks = 0;
                } else if (phaseTicks > 20 * 45) {
                    // 45秒アタリなし: 回収して投げ直す
                    mc.gameMode.useItem(p, InteractionHand.MAIN_HAND);
                    reels++;
                    phase = Phase.REEL_WAIT;
                    phaseTicks = 0;
                }
            }
            case REEL_WAIT -> {
                if (phaseTicks > 12) {
                    if (casts >= maxCasts) { finish("casts_done"); return; }
                    phase = Phase.CAST;
                }
            }
        }
    }

    private void finish(String reason) {
        JsonObject r = new JsonObject();
        r.addProperty("reason", reason);
        r.addProperty("casts", casts);
        r.addProperty("reels", reels);
        r.addProperty("bites", bites);
        result = r;
        state = State.SUCCEEDED;
    }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }

    @Override
    public void cancel() { state = State.CANCELLING; }
}
