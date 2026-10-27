package com.minecrafttogether.agent.task;

import baritone.api.IBaritone;
import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;

/**
 * Baritone追従。対象はプレイヤー名、または "minecraft:rabbit" のような
 * エンティティ種類（registry name）で指定する。
 * 追従は継続動作なので完了しない — cancelでのみ終了するタスク。
 */
public class FollowTask extends AgentTask {
    private final String targetName;
    private final boolean entityType;
    private boolean started = false;

    public FollowTask(String id, String targetName) {
        super(id);
        this.targetName = targetName;
        this.entityType = targetName.contains(":");
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        IBaritone b = GotoTask.baritone();
        if (b == null) { fail("UNSUPPORTED", "baritone not available"); return; }

        if (state == State.CANCELLING) {
            b.getFollowProcess().cancel();
            b.getPathingBehavior().cancelEverything();
            state = State.CANCELLED;
            return;
        }

        if (!started) {
            Entity target = findTarget(mc);
            if (target == null) {
                fail("NOT_FOUND", "target not found: " + targetName);
                return;
            }
            if (entityType) {
                b.getFollowProcess().follow(e -> targetName.equals(
                    BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString()));
            } else {
                b.getFollowProcess().follow(e -> e instanceof Player
                    && ((Player) e).getGameProfile().getName().equalsIgnoreCase(targetName));
            }
            JsonObject r = new JsonObject();
            r.addProperty("following", targetName);
            result = r;
            started = true;
        }
    }

    @Override
    public void cancel() { state = State.CANCELLING; }

    private Entity findTarget(Minecraft mc) {
        if (mc.level == null) return null;
        for (Entity e : mc.level.entitiesForRendering()) {
            if (entityType) {
                if (targetName.equals(BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString())) return e;
            } else if (e instanceof Player pl && pl.getGameProfile().getName().equalsIgnoreCase(targetName)) {
                return e;
            }
        }
        return null;
    }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }
}
