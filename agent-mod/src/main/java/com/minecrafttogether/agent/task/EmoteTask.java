package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;

/** crouch_dance: sneakキーを一定間隔でトグルしてお辞儀させる */
public class EmoteTask extends AgentTask {
    private int ticksLeft;

    public EmoteTask(String id, int durationTicks) {
        super(id);
        this.ticksLeft = durationTicks;
    }

    // D59/P2-8: 基底の cancel() は即 CANCELLED にするため、tick 内の
    // CANCELLING 分岐 (keyShift 解放) がデッドコードだった
    @Override
    public void cancel() { state = State.CANCELLING; }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null) {
            errorCode = "NOT_IN_GAME";
            errorMessage = "player is not in a world";
            state = State.FAILED;
            return;
        }
        if (state == State.CANCELLING) {
            mc.options.keyShift.setDown(false);
            state = State.CANCELLED;
            return;
        }
        mc.options.keyShift.setDown((ticksLeft / 4) % 2 == 0);
        if (--ticksLeft <= 0) {
            mc.options.keyShift.setDown(false);
            JsonObject r = new JsonObject();
            r.addProperty("emote", "crouch_dance");
            result = r;
            state = State.SUCCEEDED;
        }
    }
}
