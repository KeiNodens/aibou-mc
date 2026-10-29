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
 * 拡張: 任意で r (半径) と dim を持てる。r>=0 のエントリは領域扱い
 * (home safe area判定に使う)。旧形式 {x,y,z} は r=-1 の地点として読む。
 */
public final class Waypoints {
    /** r<0 は地点、r>=0 は領域 */
    public record Wp(int x, int y, int z, int r, String dim) {
        public boolean contains(double px, double py, double pz, String pdim) {
            if (r < 0) return false;
            if (dim != null && pdim != null && !dim.equals(pdim)) return false;
            return Math.abs(px - x) <= r && Math.abs(pz - z) <= r
                && Math.abs(py - y) <= r + 4;
        }
    }

    private static final Map<String, Wp> MAP = new LinkedHashMap<>();
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
                MAP.put(e.getKey(), new Wp(
                    o.get("x").getAsInt(), o.get("y").getAsInt(),
                    o.get("z").getAsInt(),
                    o.has("r") ? o.get("r").getAsInt() : -1,
                    o.has("dim") && !o.get("dim").isJsonNull()
                        ? o.get("dim").getAsString() : null));
            }
        } catch (Exception ignored) {}
    }

    private static void save() {
        JsonObject root = new JsonObject();
        for (Map.Entry<String, Wp> e : MAP.entrySet()) {
            JsonObject o = new JsonObject();
            o.addProperty("x", e.getValue().x());
            o.addProperty("y", e.getValue().y());
            o.addProperty("z", e.getValue().z());
            if (e.getValue().r() >= 0) o.addProperty("r", e.getValue().r());
            if (e.getValue().dim() != null) o.addProperty("dim", e.getValue().dim());
            root.add(e.getKey(), o);
        }
        try (Writer w = Files.newBufferedWriter(file().toPath())) {
            w.write(root.toString());
        } catch (Exception ignored) {}
    }

    public static void set(String name, int x, int y, int z) {
        set(name, x, y, z, -1, null);
    }

    public static void set(String name, int x, int y, int z, int r, String dim) {
        ensureLoaded();
        MAP.put(name, new Wp(x, y, z, r, dim));
        save();
    }

    public static Wp get(String name) {
        ensureLoaded();
        return MAP.get(name);
    }

    /** 指定座標が名前付き領域内か (r未設定の地点waypointは常にfalse) */
    public static boolean isWithin(String name, double x, double y, double z,
            String dim) {
        Wp w = get(name);
        return w != null && w.contains(x, y, z, dim);
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
        for (Map.Entry<String, Wp> e : MAP.entrySet()) {
            JsonObject o = new JsonObject();
            o.addProperty("x", e.getValue().x());
            o.addProperty("y", e.getValue().y());
            o.addProperty("z", e.getValue().z());
            if (e.getValue().r() >= 0) o.addProperty("r", e.getValue().r());
            if (e.getValue().dim() != null) o.addProperty("dim", e.getValue().dim());
            r.add(e.getKey(), o);
        }
        return r;
    }
}
