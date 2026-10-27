package com.minecrafttogether.agent.game;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.minecrafttogether.agent.AgentMod;
import com.minecrafttogether.agent.task.AgentTask;
import com.minecrafttogether.agent.task.DigTask;
import com.minecrafttogether.agent.task.EmoteTask;
import com.minecrafttogether.agent.task.FollowTask;
import com.minecrafttogether.agent.task.GotoTask;
import com.minecrafttogether.agent.task.MineTask;
import com.minecrafttogether.agent.task.TaskManager;
import java.io.File;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.CompletableFuture;
import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.Screenshot;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.Item;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/**
 * req methodの実体。必ずゲームメインスレッド上で呼ばれること
 * (AgentWsServer が Minecraft#execute で引き渡す)。
 */
public final class GameOps {
    private GameOps() {}

    /** APIエラー。codeはプロトコルのエラーコード (design §2.3) */
    public static class ApiError extends Exception {
        private final String code;
        public ApiError(String code, String message) { super(message); this.code = code; }
        public String code() { return code; }
    }

    /** JsonObjectを返すか、screenshotのように非同期完了するものはCompletionStage&lt;JsonObject&gt;を返す */
    public static Object dispatch(String method, JsonObject params) throws Exception {
        return switch (method) {
            case "mod.ping" -> ping();
            case "meta.capabilities" -> capabilities();
            case "chat.send" -> chatSend(params);
            case "chat.command" -> chatCommand(params);
            case "obs.state" -> obsState();
            case "obs.entity" -> obsEntity(params);
            case "obs.scan" -> obsScan(params);
            case "emote" -> emote(params);
            case "screenshot" -> screenshot();
            case "find_item" -> findItem(params);
            case "waypoint.set" -> waypointSet(params);
            case "waypoint.get" -> waypointGet(params);
            case "waypoint.list" -> waypointList();
            case "waypoint.del" -> waypointDel(params);
            case "move.set" -> moveSet(params);
            case "move.stop" -> moveStop();
            case "look_at" -> lookAt(params);
            case "dig" -> dig(params);
            case "equip" -> equip(params);
            case "toss" -> toss(params);
            case "baritone.goto" -> baritoneGoto(params);
            case "baritone.mine" -> baritoneMine(params);
            case "baritone.follow" -> baritoneFollow(params);
            case "baritone.stop" -> baritoneStop();
            case "task.status" -> taskStatus(params);
            case "task.result" -> taskResult(params);
            case "task.cancel" -> taskCancel(params);
            case "task.cancel_all" -> taskCancelAll();
            default -> throw new ApiError("UNSUPPORTED", method);
        };
    }

    // ---- move: キー入力状態の設定/解除。実移動・経路探索はM3 (Baritone) ----
    private static JsonObject moveSet(JsonObject params) throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        requirePlayer();
        var o = mc.options;
        if (params.has("forward")) o.keyUp.setDown(params.get("forward").getAsBoolean());
        if (params.has("back")) o.keyDown.setDown(params.get("back").getAsBoolean());
        if (params.has("left")) o.keyLeft.setDown(params.get("left").getAsBoolean());
        if (params.has("right")) o.keyRight.setDown(params.get("right").getAsBoolean());
        if (params.has("jump")) o.keyJump.setDown(params.get("jump").getAsBoolean());
        if (params.has("sneak")) o.keyShift.setDown(params.get("sneak").getAsBoolean());
        if (params.has("sprint")) o.keySprint.setDown(params.get("sprint").getAsBoolean());
        JsonObject r = new JsonObject();
        r.addProperty("applied", true);
        return r;
    }

    private static JsonObject moveStop() throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        requirePlayer();
        var o = mc.options;
        o.keyUp.setDown(false);
        o.keyDown.setDown(false);
        o.keyLeft.setDown(false);
        o.keyRight.setDown(false);
        o.keyJump.setDown(false);
        o.keyShift.setDown(false);
        o.keySprint.setDown(false);
        JsonObject r = new JsonObject();
        r.addProperty("stopped", true);
        return r;
    }

    private static JsonObject lookAt(JsonObject params) throws ApiError {
        LocalPlayer p = requirePlayer();
        Vec3 target;
        if (params.has("entity_id")) {
            Minecraft mc = Minecraft.getInstance();
            Entity e = mc.level != null ? mc.level.getEntity(params.get("entity_id").getAsInt()) : null;
            if (e == null) throw new ApiError("NOT_FOUND", "no such entity");
            target = e.getEyePosition();
        } else {
            target = new Vec3(
                params.get("x").getAsDouble(),
                params.get("y").getAsDouble(),
                params.get("z").getAsDouble());
        }
        p.lookAt(net.minecraft.commands.arguments.EntityAnchorArgument.Anchor.EYES, target);
        JsonObject r = new JsonObject();
        r.addProperty("yaw", p.getYRot());
        r.addProperty("pitch", p.getXRot());
        return r;
    }

    private static JsonObject dig(JsonObject params) throws ApiError {
        requirePlayer();
        BlockPos pos = new BlockPos(
            params.get("x").getAsInt(),
            params.get("y").getAsInt(),
            params.get("z").getAsInt());
        Direction face = Direction.UP;
        if (params.has("face")) {
            try { face = Direction.byName(params.get("face").getAsString()); }
            catch (Exception ignored) {}
        }
        DigTask t = new DigTask(TaskManager.get().newId("dig"), pos, face);
        TaskManager.get().register(t);
        JsonObject r = new JsonObject();
        r.addProperty("task_id", t.id);
        return r;
    }

    private static JsonObject equip(JsonObject params) throws ApiError {
        LocalPlayer p = requirePlayer();
        int slot = params.get("slot").getAsInt();
        if (slot < 0 || slot > 8) throw new ApiError("BAD_REQUEST", "slot must be 0-8 (hotbar)");
        p.getInventory().selected = slot;
        JsonObject r = new JsonObject();
        r.addProperty("slot", slot);
        return r;
    }

    private static JsonObject toss(JsonObject params) throws ApiError {
        LocalPlayer p = requirePlayer();
        boolean fullStack = params.has("full_stack") && params.get("full_stack").getAsBoolean();
        ItemStack held = p.getMainHandItem();
        ResourceLocation id = BuiltInRegistries.ITEM.getKey(held.getItem());
        boolean dropped = p.drop(fullStack);
        JsonObject r = new JsonObject();
        r.addProperty("dropped", dropped);
        if (dropped) {
            r.addProperty("item", id != null ? id.toString() : "unknown");
            r.addProperty("count", fullStack ? held.getCount() : 1);
        }
        return r;
    }

    private static JsonObject baritoneGoto(JsonObject params) throws ApiError {
        requirePlayer();
        int x, z;
        int y = params.has("y") ? params.get("y").getAsInt() : -1;
        if (params.has("name")) {
            int[] wp = Waypoints.get(params.get("name").getAsString());
            if (wp == null) throw new ApiError("NOT_FOUND", "unknown waypoint: " + params.get("name").getAsString());
            x = wp[0];
            if (y == -1) y = wp[1];
            z = wp[2];
        } else {
            x = params.get("x").getAsInt();
            z = params.get("z").getAsInt();
        }
        GotoTask t = new GotoTask(TaskManager.get().newId("goto"), x, y, z);
        TaskManager.get().register(t);
        JsonObject r = new JsonObject();
        r.addProperty("task_id", t.id);
        return r;
    }

    private static JsonObject baritoneMine(JsonObject params) throws ApiError {
        requirePlayer();
        String block = params.get("block").getAsString();
        int count = params.has("count") ? params.get("count").getAsInt() : 1;
        String mode = params.has("mode") ? params.get("mode").getAsString() : "additional";
        if (!mode.equals("additional") && !mode.equals("ensure"))
            throw new ApiError("BAD_REQUEST", "mode must be 'additional' or 'ensure'");
        MineTask t = new MineTask(TaskManager.get().newId("mine"), block, count, mode.equals("ensure"));
        TaskManager.get().register(t);
        JsonObject r = new JsonObject();
        r.addProperty("task_id", t.id);
        return r;
    }

    private static JsonObject baritoneFollow(JsonObject params) throws ApiError {
        requirePlayer();
        String name = params.has("target") ? params.get("target").getAsString()
            : params.get("player").getAsString();
        FollowTask t = new FollowTask(TaskManager.get().newId("follow"), name);
        TaskManager.get().register(t);
        JsonObject r = new JsonObject();
        r.addProperty("task_id", t.id);
        return r;
    }

    private static JsonObject baritoneStop() throws ApiError {
        requirePlayer();
        var b = GotoTask.baritone();
        if (b == null) throw new ApiError("UNSUPPORTED", "baritone not available");
        b.getPathingBehavior().cancelEverything();
        int n = 0;
        for (AgentTask t : TaskManager.get().all()) {
            if (!t.done()) { t.cancel(); n++; }
        }
        JsonObject r = new JsonObject();
        r.addProperty("stopped", true);
        r.addProperty("tasks_cancelled", n);
        return r;
    }

    private static JsonObject taskStatus(JsonObject params) throws ApiError {
        AgentTask t = findTask(params);
        return TaskManager.get().statusJson(t);
    }

    private static JsonObject taskResult(JsonObject params) throws ApiError {
        AgentTask t = findTask(params);
        if (!t.done()) throw new ApiError("NOT_DONE", "task " + t.id + " is " + t.stateName());
        JsonObject r = TaskManager.get().statusJson(t);
        return r;
    }

    private static JsonObject taskCancel(JsonObject params) throws ApiError {
        AgentTask t = findTask(params);
        if (t.done()) {
            JsonObject r = new JsonObject();
            r.addProperty("state", t.stateName());
            return r;
        }
        t.cancel();
        // task.done(cancelled) は次tickの TaskManager.tickAll が emit する
        JsonObject r = new JsonObject();
        r.addProperty("state", "cancelling");
        return r;
    }

    private static JsonObject taskCancelAll() {
        int n = 0;
        for (AgentTask t : TaskManager.get().all()) {
            if (!t.done()) { t.cancel(); n++; }
        }
        JsonObject r = new JsonObject();
        r.addProperty("cancelled", n);
        r.addProperty("state", "cancelling");
        return r;
    }

    private static AgentTask findTask(JsonObject params) throws ApiError {
        String id = params.has("task_id") ? params.get("task_id").getAsString() : "";
        AgentTask t = TaskManager.get().find(id);
        if (t == null) throw new ApiError("STALE_TASK", "unknown task_id: " + id);
        return t;
    }

    private static JsonObject ping() {
        JsonObject r = new JsonObject();
        r.addProperty("pong", true);
        r.addProperty("generation", AgentMod.ws() != null ? AgentMod.ws().generation() : 0);
        return r;
    }

    private static JsonObject capabilities() {
        JsonObject r = new JsonObject();
        JsonArray caps = new JsonArray();
        AgentWsCapabilities.all().forEach(caps::add);
        r.add("capabilities", caps);
        return r;
    }

    private static JsonObject chatSend(JsonObject params) throws ApiError {
        LocalPlayer p = requirePlayer();
        String text = params.has("text") ? params.get("text").getAsString() : "";
        if (text.isBlank()) throw new ApiError("BAD_REQUEST", "text is empty");
        if (p.connection != null) p.connection.sendChat(text);
        JsonObject r = new JsonObject();
        r.addProperty("sent", true);
        return r;
    }

    /** サーバーコマンド実行。先頭の / は省略可。実行可否はbot側のop権限次第 */
    private static JsonObject chatCommand(JsonObject params) throws ApiError {
        LocalPlayer p = requirePlayer();
        String cmd = params.has("command") ? params.get("command").getAsString() : "";
        if (cmd.isBlank()) throw new ApiError("BAD_REQUEST", "command is empty");
        if (cmd.startsWith("/")) cmd = cmd.substring(1);
        if (p.connection != null) p.connection.sendCommand(cmd);
        JsonObject r = new JsonObject();
        r.addProperty("sent", true);
        return r;
    }

    private static JsonObject obsState() throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = requirePlayer();

        JsonObject r = new JsonObject();

        JsonObject pos = new JsonObject();
        pos.addProperty("x", p.getX());
        pos.addProperty("y", p.getY());
        pos.addProperty("z", p.getZ());
        pos.addProperty("yaw", p.getYRot());
        pos.addProperty("pitch", p.getXRot());
        r.add("pos", pos);

        r.addProperty("health", p.getHealth());
        r.addProperty("hunger", p.getFoodData().getFoodLevel());
        r.addProperty("air", p.getAirSupply());
        r.addProperty("on_ground", p.onGround());
        r.addProperty("name", p.getGameProfile().getName());

        if (mc.level != null) {
            r.addProperty("dimension", mc.level.dimension().location().toString());
            var biome = mc.level.getBiome(p.blockPosition()).unwrapKey();
            r.addProperty("biome", biome.map(k -> k.location().toString()).orElse("unknown"));
            long dayTime = mc.level.getDayTime();
            JsonObject time = new JsonObject();
            time.addProperty("day", dayTime / 24000);
            time.addProperty("ticks", dayTime % 24000);
            time.addProperty("is_day", dayTime % 24000 < 12000);
            r.add("time", time);
        }

        // インベントリ: 要約 (id→合計) と詳細 (slot単位) の2形式 (design §4)
        var inv = p.getInventory();
        Map<String, Integer> summary = new TreeMap<>();
        JsonArray detail = new JsonArray();
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack s = inv.getItem(i);
            if (s.isEmpty()) continue;
            ResourceLocation id = BuiltInRegistries.ITEM.getKey(s.getItem());
            String idStr = id != null ? id.toString() : "unknown";
            summary.merge(idStr, s.getCount(), Integer::sum);
            JsonObject slot = new JsonObject();
            slot.addProperty("slot", i);
            slot.addProperty("id", idStr);
            slot.addProperty("count", s.getCount());
            JsonObject attrs = new JsonObject();
            if (s.isDamageableItem()) attrs.addProperty("damage", s.getDamageValue());
            if (s.isEnchanted()) attrs.addProperty("enchanted", true);
            if (s.hasTag()) attrs.addProperty("has_nbt", true);
            slot.add("attrs", attrs);
            detail.add(slot);
        }
        JsonObject summaryJson = new JsonObject();
        summary.forEach(summaryJson::addProperty);
        r.add("inventory_summary", summaryJson);
        r.add("inventory_detail", detail);
        JsonObject container = new JsonObject();
        container.addProperty("menu_id", "player_inventory");
        container.addProperty("generation", inv.getTimesChanged());
        r.add("container", container);

        // 周囲エンティティ集計 (半径24)。ブロック走査はM2以降
        Map<String, Integer> entities = new TreeMap<>();
        Map<String, Double> nearest = new TreeMap<>();
        if (mc.level != null) {
            AABB box = p.getBoundingBox().inflate(24);
            for (Entity e : mc.level.getEntities(p, box)) {
                ResourceLocation key = BuiltInRegistries.ENTITY_TYPE.getKey(e.getType());
                String id = key != null ? key.toString() : "unknown";
                entities.merge(id, 1, Integer::sum);
                nearest.merge(id, (double) e.distanceTo(p), Math::min);
            }
        }
        JsonObject nearby = new JsonObject();
        JsonObject blocksJson = new JsonObject();
        JsonObject entitiesJson = new JsonObject();
        entities.forEach(entitiesJson::addProperty);
        JsonObject nearestJson = new JsonObject();
        nearest.forEach((id, d) -> {
            JsonObject o = new JsonObject();
            o.addProperty("dist", Math.round(d * 10.0) / 10.0);
            nearestJson.add(id, o);
        });
        nearby.add("blocks", blocksJson);
        nearby.add("entities", entitiesJson);
        nearby.add("nearest", nearestJson);
        r.add("nearby", nearby);

        r.add("events_since_last", new JsonArray());
        return r;
    }

    /**
     * エンティティ検索。name はプレイヤー名または "minecraft:rabbit" 等の
     * エンティティ種類。マッチするエンティティの座標・距離一覧を返す。
     */
    private static JsonObject obsEntity(JsonObject params) throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = requirePlayer();
        String name = params.get("name").getAsString();
        boolean byType = name.contains(":");
        double radius = params.has("radius") ? params.get("radius").getAsDouble() : 48;
        JsonArray list = new JsonArray();
        if (mc.level != null) {
            AABB box = p.getBoundingBox().inflate(radius);
            for (Entity e : mc.level.getEntities(p, box)) {
                boolean match = byType
                    ? name.equals(BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString())
                    : e instanceof Player pl && pl.getGameProfile().getName().equalsIgnoreCase(name);
                if (!match) continue;
                JsonObject o = new JsonObject();
                o.addProperty("entity_id", e.getId());
                o.addProperty("id", BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString());
                if (e instanceof Player pl) o.addProperty("name", pl.getGameProfile().getName());
                o.addProperty("x", Math.round(e.getX() * 100.0) / 100.0);
                o.addProperty("y", Math.round(e.getY() * 100.0) / 100.0);
                o.addProperty("z", Math.round(e.getZ() * 100.0) / 100.0);
                o.addProperty("dist", Math.round(e.distanceTo(p) * 10.0) / 10.0);
                list.add(o);
            }
        }
        JsonObject r = new JsonObject();
        r.add("entities", list);
        r.addProperty("count", list.size());
        return r;
    }

    /**
     * 周囲スキャン (design §4 nearby形式)。プレイヤー中心の球範囲で
     * ブロック種別・エンティティ種別を集計する。ゲームスレッド上で
     * 全ブロックを舐めるため radius は64に制限 (128指定でも64扱い)。
     */
    private static JsonObject obsScan(JsonObject params) throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = requirePlayer();
        int radius = params.has("radius") ? params.get("radius").getAsInt() : 32;
        radius = Math.min(Math.max(radius, 1), 64);

        Map<String, Integer> blocks = new TreeMap<>();
        Map<String, Integer> entities = new TreeMap<>();
        Map<String, Double> nearest = new TreeMap<>();
        if (mc.level != null) {
            BlockPos c = p.blockPosition();
            BlockPos.MutableBlockPos mpos = new BlockPos.MutableBlockPos();
            int r2 = radius * radius;
            for (int dy = -radius; dy <= radius; dy++) {
                for (int dx = -radius; dx <= radius; dx++) {
                    for (int dz = -radius; dz <= radius; dz++) {
                        if (dx * dx + dy * dy + dz * dz > r2) continue;
                        mpos.set(c.getX() + dx, c.getY() + dy, c.getZ() + dz);
                        if (!mc.level.hasChunkAt(mpos)) continue;
                        var state = mc.level.getBlockState(mpos);
                        if (state.isAir()) continue;
                        ResourceLocation key = BuiltInRegistries.BLOCK.getKey(state.getBlock());
                        blocks.merge(key != null ? key.toString() : "unknown", 1, Integer::sum);
                    }
                }
            }
            AABB box = p.getBoundingBox().inflate(radius);
            for (Entity e : mc.level.getEntities(p, box)) {
                ResourceLocation key = BuiltInRegistries.ENTITY_TYPE.getKey(e.getType());
                String id = key != null ? key.toString() : "unknown";
                entities.merge(id, 1, Integer::sum);
                nearest.merge(id, (double) e.distanceTo(p), Math::min);
            }
        }
        JsonObject r = new JsonObject();
        r.addProperty("radius", radius);
        JsonObject blocksJson = new JsonObject();
        blocks.forEach(blocksJson::addProperty);
        r.add("blocks", blocksJson);
        JsonObject entitiesJson = new JsonObject();
        entities.forEach(entitiesJson::addProperty);
        r.add("entities", entitiesJson);
        JsonObject nearestJson = new JsonObject();
        nearest.forEach((id, d) -> {
            JsonObject o = new JsonObject();
            o.addProperty("dist", Math.round(d * 10.0) / 10.0);
            nearestJson.add(id, o);
        });
        r.add("nearest", nearestJson);
        return r;
    }

    // ---- 相棒感のための身体表現 ----
    // swing=腕を振る jump=跳ねる crouch_dance=お辞儀連打 (EmoteTaskへ)
    private static JsonObject emote(JsonObject params) throws ApiError {
        LocalPlayer p = requirePlayer();
        String type = params.get("type").getAsString();
        switch (type) {
            case "swing" -> p.swing(InteractionHand.MAIN_HAND);
            case "jump" -> { if (p.onGround()) p.jumpFromGround(); }
            case "crouch_dance" -> {
                EmoteTask t = new EmoteTask(TaskManager.get().newId("emote"), 32);
                TaskManager.get().register(t);
                JsonObject r = new JsonObject();
                r.addProperty("task_id", t.id);
                return r;
            }
            default -> throw new ApiError("BAD_REQUEST", "unknown emote: " + type);
        }
        JsonObject r = new JsonObject();
        r.addProperty("done", type);
        return r;
    }

    /**
     * 現在の視点をPNGで保存し {path} を返す。GL操作はレンダースレッドでのみ
     * 有効なため recordRenderCall で実行し、完了をCompletionStageで返す。
     */
    private static Object screenshot() throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        requirePlayer();
        File dir = new File(mc.gameDirectory, "agentmod-shots");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File file = new File(dir, "shot-" + System.currentTimeMillis() + ".png");
        CompletableFuture<JsonObject> fut = new CompletableFuture<>();
        RenderSystem.recordRenderCall(() -> {
            try (NativeImage img = Screenshot.takeScreenshot(mc.getMainRenderTarget())) {
                img.writeToFile(file);
                JsonObject r = new JsonObject();
                r.addProperty("path", file.getAbsolutePath());
                r.addProperty("width", img.getWidth());
                r.addProperty("height", img.getHeight());
                fut.complete(r);
            } catch (Exception e) {
                fut.completeExceptionally(e);
            }
        });
        return fut;
    }

    /**
     * アイテム検索。queryは registry名 (mekanism:iron) または翻訳済み表示名
     * (強化鉄) の部分一致。無名modのアイテムも日本語名から解決できる。
     */
    private static JsonObject findItem(JsonObject params) throws ApiError {
        String q = params.get("query").getAsString().toLowerCase();
        JsonArray list = new JsonArray();
        for (Item item : BuiltInRegistries.ITEM) {
            ResourceLocation id = BuiltInRegistries.ITEM.getKey(item);
            if (id == null) continue;
            String display = item.getDescription().getString();
            if (!id.toString().toLowerCase().contains(q) && !display.toLowerCase().contains(q)) continue;
            JsonObject o = new JsonObject();
            o.addProperty("id", id.toString());
            o.addProperty("name", display);
            list.add(o);
            if (list.size() >= 20) break;
        }
        JsonObject r = new JsonObject();
        r.add("items", list);
        r.addProperty("count", list.size());
        return r;
    }

    private static JsonObject waypointSet(JsonObject params) throws ApiError {
        LocalPlayer p = requirePlayer();
        String name = params.get("name").getAsString();
        int x = params.has("x") ? params.get("x").getAsInt() : (int) Math.floor(p.getX());
        int y = params.has("y") ? params.get("y").getAsInt() : (int) Math.floor(p.getY());
        int z = params.has("z") ? params.get("z").getAsInt() : (int) Math.floor(p.getZ());
        Waypoints.set(name, x, y, z);
        JsonObject r = new JsonObject();
        r.addProperty("saved", name);
        r.addProperty("x", x);
        r.addProperty("y", y);
        r.addProperty("z", z);
        return r;
    }

    private static JsonObject waypointGet(JsonObject params) throws ApiError {
        int[] wp = Waypoints.get(params.get("name").getAsString());
        if (wp == null) throw new ApiError("NOT_FOUND", "unknown waypoint");
        JsonObject r = new JsonObject();
        r.addProperty("x", wp[0]);
        r.addProperty("y", wp[1]);
        r.addProperty("z", wp[2]);
        return r;
    }

    private static JsonObject waypointList() {
        JsonObject r = new JsonObject();
        r.add("waypoints", Waypoints.list());
        return r;
    }

    private static JsonObject waypointDel(JsonObject params) throws ApiError {
        String name = params.get("name").getAsString();
        if (!Waypoints.del(name)) throw new ApiError("NOT_FOUND", "unknown waypoint: " + name);
        JsonObject r = new JsonObject();
        r.addProperty("deleted", name);
        return r;
    }

    private static LocalPlayer requirePlayer() throws ApiError {
        LocalPlayer p = Minecraft.getInstance().player;
        if (p == null) throw new ApiError("NOT_IN_GAME", "player is not in a world");
        return p;
    }
}
