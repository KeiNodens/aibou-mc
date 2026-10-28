package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;
import com.minecrafttogether.agent.game.JadeBridge;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;

/**
 * 対象を見てJadeツールチップを読む (design look_info)。
 * Jadeのサーバーデータ往復を待つため数tick遅延させる。
 * Jade未ロード時は視線先のブロックIDだけ返すフォールバック。
 */
public class LookInfoTask extends AgentTask {
    private final Vec3 targetPos;
    private final Integer entityId;
    private int phase = 0; // 0=aim 1=wait 2=read
    private int waitTicks = 0;
    private static final int WAIT = 15; // jade server data往復+provider収集の猶予

    public LookInfoTask(String id, Vec3 targetPos, Integer entityId) {
        super(id);
        this.targetPos = targetPos;
        this.entityId = entityId;
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        if (state == State.CANCELLING) { state = State.CANCELLED; return; }

        switch (phase) {
            case 0 -> {
                if (entityId != null) {
                    Entity e = mc.level != null ? mc.level.getEntity(entityId) : null;
                    if (e == null) { fail("NOT_FOUND", "no such entity"); return; }
                    p.lookAt(net.minecraft.commands.arguments.EntityAnchorArgument.Anchor.EYES,
                        e.getEyePosition());
                } else if (targetPos != null) {
                    p.lookAt(net.minecraft.commands.arguments.EntityAnchorArgument.Anchor.EYES,
                        targetPos);
                }
                phase = 1;
                waitTicks = 0;
            }
            case 1 -> {
                if (++waitTicks < WAIT) return;
                phase = 2;
            }
            case 2 -> {
                JsonObject r;
                if (JadeBridge.isAvailable()) {
                    r = JadeBridge.readLookedAt();
                } else {
                    r = fallback(mc, p);
                }
                result = r;
                state = State.SUCCEEDED;
            }
        }
    }

    /** Jade不在時: クロスヘア先のブロックをraytraceしてIDだけ返す */
    private JsonObject fallback(Minecraft mc, LocalPlayer p) {
        JsonObject r = new JsonObject();
        r.addProperty("jade", false);
        var hit = mc.hitResult;
        if (hit != null && hit.getType() == net.minecraft.world.phys.HitResult.Type.BLOCK) {
            var bhr = (net.minecraft.world.phys.BlockHitResult) hit;
            BlockPos pos = bhr.getBlockPos();
            var key = BuiltInRegistries.BLOCK.getKey(mc.level.getBlockState(pos).getBlock());
            r.addProperty("type", "block");
            r.addProperty("id", key != null ? key.toString() : "unknown");
            r.addProperty("x", pos.getX());
            r.addProperty("y", pos.getY());
            r.addProperty("z", pos.getZ());
        } else if (hit != null && hit.getType() == net.minecraft.world.phys.HitResult.Type.ENTITY) {
            Entity e = ((net.minecraft.world.phys.EntityHitResult) hit).getEntity();
            var key = BuiltInRegistries.ENTITY_TYPE.getKey(e.getType());
            r.addProperty("type", "entity");
            r.addProperty("id", key != null ? key.toString() : "unknown");
            r.addProperty("entity_id", e.getId());
            r.addProperty("name", e.getName().getString());
        } else {
            r.addProperty("type", "none");
        }
        return r;
    }

    @Override
    public void cancel() { state = State.CANCELLING; }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }
}
