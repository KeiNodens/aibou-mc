package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.InteractionHand;

/**
 * use_itemの保持→解放版。弓の引き絞り・トライデント・弩・盾に対応。
 * 実入力経路 (keyUse down) で使用を継続し、holdTicks経過後に keyUse up
 * で解放する (vanillaのreleaseUsingItemが自然に走る)。
 */
public class UseHoldTask extends AgentTask {
    private final InteractionHand hand;
    private final int holdTicks;
    private final boolean sneak;
    private int t = 0;
    private boolean started = false;

    public UseHoldTask(String id, InteractionHand hand, int holdTicks) {
        this(id, hand, holdTicks, false);
    }

    public UseHoldTask(String id, InteractionHand hand, int holdTicks,
            boolean sneak) {
        super(id);
        this.hand = hand;
        this.holdTicks = Math.max(1, holdTicks);
        this.sneak = sneak;
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        if (state == State.CANCELLING) {
            release(mc, p);
            state = State.CANCELLED;
            return;
        }

        if (!started) {
            // 使用キーを押下。main handで使えなければvanilla経路でoffhandに
            // フォールスルーする (実入力と同じ優先度)
            if (sneak)
                com.minecrafttogether.agent.game.GameOps.beginSneak(p);
            mc.options.keyUse.setDown(true);
            started = true;
            return;
        }

        if (++t < holdTicks) {
            // 開始猶予を過ぎても使えていない = 対象が使用不可 (空の手・使えないitem)
            if (t > 5 && !p.isUsingItem()) {
                release(mc, p);
                finish("use did not start or completed early");
                return;
            }
            return;
        }
        release(mc, p);
        finish("released after " + t + " ticks");
    }

    private void release(Minecraft mc, LocalPlayer p) {
        mc.options.keyUse.setDown(false);
        if (p.isUsingItem()) mc.gameMode.releaseUsingItem(p);
        if (sneak)
            com.minecrafttogether.agent.game.GameOps.endSneak(p);
    }

    private void finish(String note) {
        JsonObject r = new JsonObject();
        r.addProperty("held_ticks", t);
        r.addProperty("note", note);
        result = r;
        state = State.SUCCEEDED;
    }

    @Override
    public void cancel() { state = State.CANCELLING; }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }
}
