package com.minecrafttogether.agent.game;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.minecrafttogether.agent.AgentMod;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.level.Level;
import net.minecraftforge.fml.ModList;

/**
 * JourneyMap連携の隔離層 (全リフレクション)。
 * journeymap未ロード環境では isAvailable()=false で一切触れない。
 * ClientAPIはenumシングルトン (journeymap.api.client.impl.ClientAPI#INSTANCE)。
 */
public final class JourneyMapBridge {
    private JourneyMapBridge() {}

    public static boolean isAvailable() {
        return ModList.get().isLoaded("journeymap");
    }

    private static Object api() throws ReflectiveOperationException {
        return Class.forName("journeymap.api.client.impl.ClientAPI")
            .getField("INSTANCE").get(null);
    }

    private static Class<?> waypointIf() throws ReflectiveOperationException {
        return Class.forName("journeymap.api.v2.common.waypoint.Waypoint");
    }

    /** waypointをJMに登録 (agentmodグループ配下・永続) */
    public static void set(String name, BlockPos pos, ResourceKey<Level> dim)
            throws ReflectiveOperationException {
        Class<?> factory = Class.forName(
            "journeymap.api.v2.common.waypoint.WaypointFactory");
        Object wp = factory.getMethod("createWaypoint",
                String.class, BlockPos.class, String.class,
                ResourceKey.class, boolean.class)
            .invoke(null, AgentMod.MOD_ID, pos, name, dim, true);
        Object a = api();
        a.getClass().getMethod("addWaypoint", String.class, waypointIf())
            .invoke(a, AgentMod.MOD_ID, wp);
    }

    /** 同名waypointをJMから削除。無ければfalse */
    public static boolean del(String name) throws ReflectiveOperationException {
        Object a = api();
        Object wp = findByName(a, name);
        if (wp == null) return false;
        a.getClass().getMethod("removeWaypoint", String.class, waypointIf())
            .invoke(a, AgentMod.MOD_ID, wp);
        return true;
    }

    /** 全waypoint列挙 (agentmodグループのみ) */
    public static JsonArray list() throws ReflectiveOperationException {
        Object a = api();
        Object wps = a.getClass().getMethod("getWaypoints", String.class)
            .invoke(a, AgentMod.MOD_ID);
        JsonArray out = new JsonArray();
        for (Object wp : (Iterable<?>) wps) {
            JsonObject o = new JsonObject();
            o.addProperty("name", str(wp, "getName"));
            Object bp = wp.getClass().getMethod("getBlockPos").invoke(wp);
            o.addProperty("x", (Integer) bp.getClass()
                .getMethod("getX").invoke(bp));
            o.addProperty("y", (Integer) bp.getClass()
                .getMethod("getY").invoke(bp));
            o.addProperty("z", (Integer) bp.getClass()
                .getMethod("getZ").invoke(bp));
            out.add(o);
        }
        return out;
    }

    private static Object findByName(Object a, String name)
            throws ReflectiveOperationException {
        Object wps = a.getClass().getMethod("getWaypoints", String.class)
            .invoke(a, AgentMod.MOD_ID);
        for (Object wp : (Iterable<?>) wps) {
            if (name.equals(str(wp, "getName"))) return wp;
        }
        return null;
    }

    private static String str(Object o, String m)
            throws ReflectiveOperationException {
        Object v = o.getClass().getMethod(m).invoke(o);
        return v == null ? null : v.toString();
    }
}
