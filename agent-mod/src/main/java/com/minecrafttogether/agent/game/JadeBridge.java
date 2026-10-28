package com.minecrafttogether.agent.game;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;
import net.minecraftforge.fml.ModList;
import snownee.jade.api.Accessor;
import snownee.jade.api.BlockAccessor;
import snownee.jade.api.EntityAccessor;
import snownee.jade.impl.ObjectDataCenter;
import snownee.jade.impl.Tooltip;
import snownee.jade.overlay.TooltipRenderer;
import snownee.jade.overlay.WailaTickHandler;

/**
 * Jade連携の隔離層。Jadeクラスへの参照をこのクラス内に閉じ込め、
 * jade未ロード環境では isAvailable() がfalseを返して一切触れない
 * (このクラス自体がロードされるとリンクエラーになるので、
 * 呼び出し側は必ず isLoaded ガードを先に行うこと)。
 */
public final class JadeBridge {
    private JadeBridge() {}

    public static boolean isAvailable() {
        return ModList.get().isLoaded("jade");
    }

    /**
     * 現在プレイヤーが見ている対象について、Jadeが収集した
     * ツールチップ (機械の電力・進捗・内容物等) を読む。
     * look_atで先に対象を向けておくこと。
     */
    public static JsonObject readLookedAt() {
        JsonObject r = new JsonObject();
        Minecraft mc = Minecraft.getInstance();

        // 現在の対象 (accessor) から registry id を取る
        Accessor<?> acc = ObjectDataCenter.get();
        if (acc instanceof BlockAccessor ba) {
            var key = BuiltInRegistries.BLOCK.getKey(ba.getBlockState().getBlock());
            r.addProperty("type", "block");
            r.addProperty("id", key != null ? key.toString() : "unknown");
            var pos = ba.getPosition();
            r.addProperty("x", pos.getX());
            r.addProperty("y", pos.getY());
            r.addProperty("z", pos.getZ());
        } else if (acc instanceof EntityAccessor ea) {
            Entity e = ea.getEntity();
            var key = BuiltInRegistries.ENTITY_TYPE.getKey(e.getType());
            r.addProperty("type", "entity");
            r.addProperty("id", key != null ? key.toString() : "unknown");
            r.addProperty("entity_id", e.getId());
            r.addProperty("name", e.getName().getString());
        } else {
            r.addProperty("type", "none");
        }

        // 表示中のtooltipをテキスト化
        JsonArray lines = new JsonArray();
        TooltipRenderer tr = WailaTickHandler.instance().tooltipRenderer;
        if (tr != null) {
            Tooltip tip = tr.getTooltip();
            if (tip != null) {
                String msg = tip.getMessage();
                if (msg != null) {
                    for (String line : msg.split("\\r?\\n")) {
                        String s = line.strip();
                        if (!s.isEmpty()) lines.add(s);
                    }
                }
            }
        }
        r.add("lines", lines);
        r.addProperty("server_data", ObjectDataCenter.getServerData() != null);
        return r;
    }
}
