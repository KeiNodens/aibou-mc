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
 * 反射系のcapability学習 (Elly式)。試行して動かなかった能力をfalseで記憶し、
 * 以後その反射は発火しない。未試行=キー無し。
 * gameDir/agentmod-capabilities.json に保存する。
 */
public final class AgentCapabilities {
    private static final Map<String, Boolean> MAP = new LinkedHashMap<>();
    private static boolean loaded = false;

    private AgentCapabilities() {}

    private static File file() {
        return new File(Minecraft.getInstance().gameDirectory,
            "agentmod-capabilities.json");
    }

    private static void ensureLoaded() {
        if (loaded) return;
        loaded = true;
        File f = file();
        if (!f.isFile()) return;
        try (Reader r = Files.newBufferedReader(f.toPath())) {
            JsonObject root = JsonParser.parseReader(r).getAsJsonObject();
            for (Map.Entry<String, com.google.gson.JsonElement> e : root.entrySet()) {
                MAP.put(e.getKey(), e.getValue().getAsBoolean());
            }
        } catch (Exception ignored) {}
    }

    private static void save() {
        JsonObject root = new JsonObject();
        for (Map.Entry<String, Boolean> e : MAP.entrySet()) {
            root.addProperty(e.getKey(), e.getValue());
        }
        try (Writer w = Files.newBufferedWriter(file().toPath())) {
            w.write(root.toString());
        } catch (Exception ignored) {}
    }

    /** 実行可能か (false記憶済みのみfalse。未試行はtrue) */
    public static boolean isOk(String key) {
        ensureLoaded();
        return MAP.getOrDefault(key, true);
    }

    public static void learn(String key, boolean works) {
        ensureLoaded();
        MAP.put(key, works);
        save();
    }
}
