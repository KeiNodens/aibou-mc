package com.minecrafttogether.agent.game;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.File;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.Minecraft;

/**
 * 名前付き地点の永続化。「うち」等のラベル→座標。
 * gameDir/agentmod-waypoints.json に保存する。
 */
public final class Waypoints {
    private static final Map<String, int[]> MAP = new LinkedHashMap<>();
    private static boolean loaded = false;

    private Waypoints() {}

    private static File file() {
        return new File(Minecraft.getInstance().gameDirectory, "agentmod-waypoints.json");
    }

    private static void ensureLoaded() {
        if (loaded) return;
        loaded = true;
        File f = file();
        if (!f.isFile()) return;
        try (Reader r = Files.newBufferedReader(f.toPath())) {
            JsonObject root = JsonParser.parseReader(r).getAsJsonObject();
            for (Map.Entry<String, com.google.gson.JsonElement> e : root.entrySet()) {
                JsonObject o = e.getValue().getAsJsonObject();
                MAP.put(e.getKey(), new int[]{
                    o.get("x").getAsInt(), o.get("y").getAsInt(), o.get("z").getAsInt()});
            }
        } catch (Exception ignored) {}
    }

    private static void save() {
        JsonObject root = new JsonObject();
        for (Map.Entry<String, int[]> e : MAP.entrySet()) {
            JsonObject o = new JsonObject();
            o.addProperty("x", e.getValue()[0]);
            o.addProperty("y", e.getValue()[1]);
            o.addProperty("z", e.getValue()[2]);
            root.add(e.getKey(), o);
        }
        try (Writer w = Files.newBufferedWriter(file().toPath())) {
            w.write(root.toString());
        } catch (Exception ignored) {}
    }

    public static void set(String name, int x, int y, int z) {
        ensureLoaded();
        MAP.put(name, new int[]{x, y, z});
        save();
    }

    public static int[] get(String name) {
        ensureLoaded();
        return MAP.get(name);
    }

    public static boolean del(String name) {
        ensureLoaded();
        boolean ok = MAP.remove(name) != null;
        if (ok) save();
        return ok;
    }

    public static JsonObject list() {
        ensureLoaded();
        JsonObject r = new JsonObject();
        for (Map.Entry<String, int[]> e : MAP.entrySet()) {
            JsonObject o = new JsonObject();
            o.addProperty("x", e.getValue()[0]);
            o.addProperty("y", e.getValue()[1]);
            o.addProperty("z", e.getValue()[2]);
            r.add(e.getKey(), o);
        }
        return r;
    }
}
