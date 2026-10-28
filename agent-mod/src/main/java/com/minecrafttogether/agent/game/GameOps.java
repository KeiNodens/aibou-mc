package com.minecrafttogether.agent.game;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.minecrafttogether.agent.AgentMod;
import com.minecrafttogether.agent.task.AgentTask;
import com.minecrafttogether.agent.task.CraftTask;
import com.minecrafttogether.agent.task.DigTask;
import com.minecrafttogether.agent.task.EmoteTask;
import com.minecrafttogether.agent.task.FollowTask;
import com.minecrafttogether.agent.task.GotoTask;
import com.minecrafttogether.agent.task.LookInfoTask;
import com.minecrafttogether.agent.task.MineTask;
import com.minecrafttogether.agent.task.TaskManager;
import com.minecrafttogether.agent.task.UseHoldTask;
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
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.RecipeBookMenu;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
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
            case "obs.block" -> obsBlock(params);
            case "obs.block_state" -> obsBlockState(params);
            case "look_info" -> lookInfo(params);
            case "interact" -> interact(params);
            case "use_item" -> useItem(params);
            case "container.read" -> containerRead();
            case "container.click" -> containerClick(params);
            case "container.button" -> containerButton(params);
            case "container.trade" -> containerTrade(params);
            case "container.repo" -> containerRepo();
            case "container.repo_action" -> containerRepoAction(params);
            case "container.close" -> containerClose();
            case "inventory.resync" -> inventoryResync();
            case "recipe.lookup" -> recipeLookup(params);
            case "craft" -> craft(params);
            case "emote" -> emote(params);
            case "respawn" -> respawn();
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
        // 手持ち選択はサーバーが別管理 — 通知しないとサーバーは古いslotのitemを使う
        if (p.connection != null)
            p.connection.send(new net.minecraft.network.protocol.game.ServerboundSetCarriedItemPacket(slot));
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

    /**
     * 右クリック使用。target無し=空中使用 (食べる/道具)、
     * {x,y,z,face}指定=ブロックへの使用 (設置/コンテナを開く/操作)。
     */
    private static JsonObject useItem(JsonObject params) throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = requirePlayer();
        InteractionHand hand = params.has("hand")
            && params.get("hand").getAsString().equalsIgnoreCase("off")
            ? InteractionHand.OFF_HAND : InteractionHand.MAIN_HAND;
        JsonObject r = new JsonObject();
        // hold_ticks指定: 使用を保持してN tick後にrelease (弓・トライデント・盾等)
        if (params.has("hold_ticks") && !params.has("x")) {
            UseHoldTask t = new UseHoldTask(
                TaskManager.get().newId("use"),
                hand, params.get("hold_ticks").getAsInt());
            TaskManager.get().register(t);
            r.addProperty("task_id", t.id);
            return r;
        }
        if (params.has("x")) {
            BlockPos pos = new BlockPos(
                params.get("x").getAsInt(),
                params.get("y").getAsInt(),
                params.get("z").getAsInt());
            Direction face = Direction.UP;
            if (params.has("face")) {
                try { face = Direction.byName(params.get("face").getAsString()); }
                catch (Exception ignored) {}
            }
            Vec3 hit = Vec3.atCenterOf(pos).relative(face, 0.5);
            var res = mc.gameMode.useItemOn(p, hand, new BlockHitResult(hit, face, pos, false));
            r.addProperty("used_on", pos.toShortString());
            r.addProperty("result", res.toString().toLowerCase());
        } else {
            var res = mc.gameMode.useItem(p, hand);
            r.addProperty("result", res.toString().toLowerCase());
        }
        return r;
    }

    /**
     * 指定ブロックの座標検索。プレイヤー中心の球範囲から近い順に最大16件。
     * 作業台・チェスト・機械を見つけるための観測。radius上限64。
     */
    private static JsonObject obsBlock(JsonObject params) throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = requirePlayer();
        String name = params.get("block").getAsString();
        ResourceLocation want = ResourceLocation.tryParse(name);
        if (want == null) throw new ApiError("BAD_REQUEST", "bad block id: " + name);
        int radius = params.has("radius") ? params.get("radius").getAsInt() : 32;
        radius = Math.min(Math.max(radius, 1), 64);

        JsonArray found = new JsonArray();
        if (mc.level != null) {
            BlockPos c = p.blockPosition();
            BlockPos.MutableBlockPos mpos = new BlockPos.MutableBlockPos();
            int r2 = radius * radius;
            for (int dy = -radius; dy <= radius; dy++) {
                for (int dx = -radius; dx <= radius; dx++) {
                    for (int dz = -radius; dz <= radius; dz++) {
                        int d2 = dx * dx + dy * dy + dz * dz;
                        if (d2 > r2) continue;
                        mpos.set(c.getX() + dx, c.getY() + dy, c.getZ() + dz);
                        if (!mc.level.hasChunkAt(mpos)) continue;
                        var state = mc.level.getBlockState(mpos);
                        ResourceLocation key = BuiltInRegistries.BLOCK.getKey(state.getBlock());
                        if (key == null || !key.equals(want)) continue;
                        JsonObject o = new JsonObject();
                        o.addProperty("x", mpos.getX());
                        o.addProperty("y", mpos.getY());
                        o.addProperty("z", mpos.getZ());
                        o.addProperty("d2", d2);
                        o.addProperty("dist", Math.round(Math.sqrt(d2) * 10.0) / 10.0);
                        found.add(o);
                    }
                }
            }
        }
        // 近い順にソートして最大16件 (d2は内部ソート用)
        java.util.List<JsonObject> sorted = new java.util.ArrayList<>();
        for (var e : found) sorted.add(e.getAsJsonObject());
        sorted.sort(java.util.Comparator.comparingInt(o -> o.get("d2").getAsInt()));
        JsonArray out = new JsonArray();
        for (int i = 0; i < Math.min(16, sorted.size()); i++) {
            JsonObject o = sorted.get(i);
            o.remove("d2");
            out.add(o);
        }
        JsonObject r = new JsonObject();
        r.addProperty("block", name);
        r.addProperty("radius", radius);
        r.add("found", out);
        r.addProperty("count", out.size());
        return r;
    }

    /**
     * 指定座標のブロック詳細。blockstateプロパティと
     * block entityの同期NBT (getUpdateTag) を返す。
     * 機械の進捗・電力・流体等をJade無しでも調べられる診断用。
     */
    private static JsonObject obsBlockState(JsonObject params) throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        requirePlayer();
        BlockPos pos = new BlockPos(
            params.get("x").getAsInt(),
            params.get("y").getAsInt(),
            params.get("z").getAsInt());
        var state = mc.level.getBlockState(pos);
        ResourceLocation key = BuiltInRegistries.BLOCK.getKey(state.getBlock());
        JsonObject r = new JsonObject();
        r.addProperty("block", key != null ? key.toString() : "unknown");
        r.addProperty("x", pos.getX());
        r.addProperty("y", pos.getY());
        r.addProperty("z", pos.getZ());
        JsonObject props = new JsonObject();
        state.getValues().forEach((prop, val) ->
            props.addProperty(prop.getName(), val.toString()));
        r.add("properties", props);
        var be = mc.level.getBlockEntity(pos);
        if (be != null) {
            var tag = be.getUpdateTag();
            if (tag != null) {
                String snbt = tag.toString();
                if (snbt.length() > 4000) snbt = snbt.substring(0, 4000) + "...";
                r.addProperty("be_nbt", snbt);
            }
        }
        return r;
    }

    /**
     * Jade連携。対象を見てtooltipテキストを返すtask (design look_info)。
     * x,y,z または entity_id を指定すると先に視線を向ける。
     * 指定なしなら現在見ているものを読む。
     */
    private static JsonObject lookInfo(JsonObject params) throws ApiError {
        LocalPlayer p = requirePlayer();
        Vec3 target = null;
        Integer entityId = null;
        if (params.has("entity_id")) {
            entityId = params.get("entity_id").getAsInt();
        } else if (params.has("x")) {
            target = new Vec3(
                params.get("x").getAsDouble(),
                params.get("y").getAsDouble(),
                params.get("z").getAsDouble());
        }
        LookInfoTask t = new LookInfoTask(
            TaskManager.get().newId("look"), target, entityId);
        TaskManager.get().register(t);
        JsonObject r = new JsonObject();
        r.addProperty("task_id", t.id);
        return r;
    }

    /**
     * エンティティへの右クリック。餌やり・調教・乳搾り・ハサミ・
     * リード・名札・騎乗・村人との取引開始をカバーする汎用操作。
     * 取引menuはサーバーが開くので、後続はcontainer.*で操作する。
     */
    private static JsonObject interact(JsonObject params) throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = requirePlayer();
        Entity e = null;
        if (params.has("entity_id")) {
            e = mc.level != null ? mc.level.getEntity(params.get("entity_id").getAsInt()) : null;
        }
        if (e == null) throw new ApiError("NOT_FOUND", "no such entity");
        // 届かない相手へのinteractをローカル成功で誤魔化さないよう距離検査
        double reach = p.getEntityReach();
        if (p.distanceTo(e) > reach + 1.0) {
            throw new ApiError("OUT_OF_RANGE",
                String.format("entity is %.1f blocks away (reach %.1f)", p.distanceTo(e), reach));
        }
        InteractionHand hand = params.has("hand")
            && params.get("hand").getAsString().equalsIgnoreCase("off")
            ? InteractionHand.OFF_HAND : InteractionHand.MAIN_HAND;
        var res = mc.gameMode.interact(p, e, hand);
        JsonObject r = new JsonObject();
        r.addProperty("entity_id", e.getId());
        r.addProperty("type", BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString());
        r.addProperty("result", res.toString().toLowerCase());
        return r;
    }

    // ---- コンテナ/slot操作 (意味レベル、画面座標ではない) ----

    private static JsonObject menuJson(AbstractContainerMenu menu) {
        JsonObject r = new JsonObject();
        r.addProperty("container_id", menu.containerId);
        ResourceLocation typeId = null;
        try {
            // InventoryMenu.getType() は UnsupportedOperationException を投げる
            var type = menu.getType();
            typeId = type != null ? BuiltInRegistries.MENU.getKey(type) : null;
        } catch (Exception ignored) {}
        r.addProperty("menu_id", typeId != null ? typeId.toString() : "player_inventory");
        ItemStack carried = menu.getCarried();
        ResourceLocation carriedId = BuiltInRegistries.ITEM.getKey(carried.getItem());
        r.addProperty("carried", carried.isEmpty() ? null : carriedId + " x" + carried.getCount());
        // slotが属するContainer (機械inv / player inv等) をインスタンス単位でグループ化。
        // 機械GUIでは machine側containerとplayer invが別オブジェクト — 定義JSONなしで
        // input/output領域の自動推定が可能になる。mod側slotクラス名も併記する。
        java.util.Map<net.minecraft.world.Container, Integer> containers =
            new java.util.IdentityHashMap<>();
        int[] nextIdx = {0};
        JsonArray slots = new JsonArray();
        for (int i = 0; i < menu.slots.size(); i++) {
            Slot s = menu.slots.get(i);
            ItemStack st = s.getItem();
            JsonObject o = new JsonObject();
            o.addProperty("slot", i);
            net.minecraft.world.Container cont = s.container;
            Integer cidx = containers.get(cont);
            if (cidx == null) {
                cidx = nextIdx[0]++;
                containers.put(cont, cidx);
            }
            o.addProperty("container_idx", cidx);
            String cls = s.getClass().getSimpleName();
            if (!cls.equals("Slot") && !cls.equals("ResultSlot")) {
                o.addProperty("slot_class", cls);
            }
            if (st.isEmpty()) {
                o.addProperty("empty", true);
            } else {
                ResourceLocation id = BuiltInRegistries.ITEM.getKey(st.getItem());
                o.addProperty("id", id != null ? id.toString() : "unknown");
                o.addProperty("count", st.getCount());
            }
            slots.add(o);
        }
        r.add("slots", slots);
        // 各containerのslot数 (大きい方がplayer inv側とみなせる)
        JsonObject contCounts = new JsonObject();
        int[] counts = new int[nextIdx[0]];
        for (int i = 0; i < menu.slots.size(); i++) {
            counts[containers.get(menu.slots.get(i).container)]++;
        }
        for (int i = 0; i < counts.length; i++) {
            contCounts.addProperty(String.valueOf(i), counts[i]);
        }
        r.add("container_sizes", contCounts);
        return r;
    }

    private static JsonObject containerRead() throws ApiError {
        LocalPlayer p = requirePlayer();
        return menuJson(p.containerMenu);
    }

    /**
     * slotクリック。action: pickup|quick_move|swap|throw|clone|pickup_all|quick_craft
     * button: 0=左 1=右。swapはbuttonがホットバーindex (0-8)。
     */
    private static JsonObject containerClick(JsonObject params) throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = requirePlayer();
        int slot = params.get("slot").getAsInt();
        int button = params.has("button") ? params.get("button").getAsInt() : 0;
        String action = params.has("action") ? params.get("action").getAsString() : "pickup";
        ClickType type = switch (action) {
            case "pickup" -> ClickType.PICKUP;
            case "quick_move" -> ClickType.QUICK_MOVE;
            case "swap" -> ClickType.SWAP;
            case "throw" -> ClickType.THROW;
            case "clone" -> ClickType.CLONE;
            case "pickup_all" -> ClickType.PICKUP_ALL;
            case "quick_craft" -> ClickType.QUICK_CRAFT;
            default -> throw new ApiError("BAD_REQUEST", "unknown action: " + action);
        };
        AbstractContainerMenu menu = p.containerMenu;
        if (params.has("menu_id")) {
            String want = params.get("menu_id").getAsString();
            JsonObject cur = menuJson(menu);
            if (!cur.get("menu_id").getAsString().equals(want))
                throw new ApiError("STALE_STATE",
                    "menu is now " + cur.get("menu_id").getAsString() + ", not " + want);
        }
        if (slot < 0 || slot >= menu.slots.size())
            throw new ApiError("BAD_REQUEST", "slot out of range 0-" + (menu.slots.size() - 1));
        mc.gameMode.handleInventoryMouseClick(menu.containerId, slot, button, type, p);
        JsonObject r = new JsonObject();
        r.addProperty("clicked", slot);
        r.addProperty("action", action);
        return r;
    }

    /**
     * menuのボタン押下 (エンチャント台の選択、石切台・織機のレシピ選択、
     * ビーコン効果決定等)。button_idはmenu側の定義依存。
     */
    private static JsonObject containerButton(JsonObject params) throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = requirePlayer();
        AbstractContainerMenu menu = p.containerMenu;
        int buttonId = params.get("button_id").getAsInt();
        mc.gameMode.handleInventoryButtonClick(menu.containerId, buttonId);
        JsonObject r = new JsonObject();
        r.addProperty("container_id", menu.containerId);
        r.addProperty("button_id", buttonId);
        return r;
    }

    /** 村人取引の候補選択。選択後はresult slotをcontainer.clickで取る */
    private static JsonObject containerTrade(JsonObject params) throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        requirePlayer();
        int index = params.get("index").getAsInt();
        mc.getConnection().send(
            new net.minecraft.network.protocol.game.ServerboundSelectTradePacket(index));
        JsonObject r = new JsonObject();
        r.addProperty("trade_index", index);
        return r;
    }

    /**
     * AE2等の仮想インベントリrepo (ターミナル画面) の読み出し。
     * 画面にIClientRepo相当のフィールドがあれば中身を全列挙する。
     * 通常のslotを持たないGUI (MEターミナル等) の在庫参照用。
     */
    private static JsonObject containerRepo() throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = requirePlayer();
        net.minecraft.client.gui.screens.Screen screen = mc.screen;
        if (screen == null)
            throw new ApiError("NO_MENU", "no screen open");
        try {
            Class<?> repoIf = Class.forName("appeng.menu.me.common.IClientRepo");
            // repoフィールドは親クラス (MEStorageScreen等) 宣言の場合があるため階層を遡る
            Object repo = null;
            for (Class<?> c = screen.getClass(); c != null && repo == null;
                    c = c.getSuperclass()) {
                for (java.lang.reflect.Field f : c.getDeclaredFields()) {
                    if (repoIf.isAssignableFrom(f.getType())) {
                        f.setAccessible(true);
                        repo = f.get(screen);
                        break;
                    }
                }
            }
            if (repo == null)
                throw new ApiError("NOT_SUPPORTED",
                    "screen " + screen.getClass().getName() + " has no repo field");
            int size = (Integer) repo.getClass().getMethod("size").invoke(repo);
            java.lang.reflect.Method get = repo.getClass().getMethod("get", int.class);
            JsonArray entries = new JsonArray();
            for (int i = 0; i < size && i < 500; i++) {
                Object e = get.invoke(repo, i);
                Object what = e.getClass().getMethod("getWhat").invoke(e);
                Object keyId = what.getClass().getMethod("getId").invoke(what);
                JsonObject je = new JsonObject();
                je.addProperty("serial",
                    ((Number) e.getClass().getMethod("getSerial").invoke(e)).longValue());
                je.addProperty("id", String.valueOf(keyId));
                je.addProperty("key_type", what.getClass().getSimpleName());
                je.addProperty("amount",
                    ((Number) e.getClass().getMethod("getStoredAmount").invoke(e)).longValue());
                je.addProperty("requestable",
                    ((Number) e.getClass().getMethod("getRequestableAmount").invoke(e)).longValue());
                je.addProperty("craftable",
                    (Boolean) e.getClass().getMethod("isCraftable").invoke(e));
                entries.add(je);
            }
            JsonObject r = new JsonObject();
            r.addProperty("screen", screen.getClass().getSimpleName());
            r.addProperty("size", size);
            r.add("entries", entries);
            // 診断: MEStorageMenu.hasPower (入出庫が通るかの目安)
            try {
                java.lang.reflect.Field hp = p.containerMenu.getClass()
                    .getField("hasPower");
                r.addProperty("has_power", hp.getBoolean(p.containerMenu));
            } catch (Throwable ignored) {
            }
            return r;
        } catch (ApiError ae) {
            throw ae;
        } catch (ReflectiveOperationException e) {
            throw new ApiError("NOT_SUPPORTED", "no AE2 repo API: " + e.getMessage());
        }
    }

    /**
     * AE2 repo上のアクション。
     * serial指定: repo内アイテムの取り出し → MEInteractionPacket(containerId, serial, action)
     *   (MEStorageScreenがrepoクリック時に実際に送るパケット。SHIFT_CLICK=全量取り出し)
     * slot指定: AEBaseMenu.doAction 経由のスロット操作 → InventoryActionPacket(action, slot, id)
     *   (FakeSlot/CraftingTermSlot/ConfigMenuInventory向け。通常のプレイヤーinv slotからの
     *    入庫は vanilla quick_move = container_click quick_move が正規経路)
     */
    private static JsonObject containerRepoAction(JsonObject params) throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = requirePlayer();
        try {
            @SuppressWarnings("unchecked")
            Class<Enum<?>> actCls = (Class<Enum<?>>)
                Class.forName("appeng.helpers.InventoryAction").asSubclass(Enum.class);
            String actName = params.get("action").getAsString();
            Object pkt;
            if (actName.equals("CONFIRM_AUTO_CRAFT")) {
                // オートクラフト数量確定: AUTO_CRAFTで開いたCraftAmountMenuへの応答
                int amount = params.has("amount")
                    ? params.get("amount").getAsInt() : 1;
                boolean craftMissing = params.has("craft_missing")
                    && params.get("craft_missing").getAsBoolean();
                boolean autoStart = !params.has("auto_start")
                    || params.get("auto_start").getAsBoolean();
                Class<?> cap = Class.forName(
                    "appeng.core.sync.packets.ConfirmAutoCraftPacket");
                pkt = cap.getConstructor(int.class, boolean.class, boolean.class)
                    .newInstance(amount, craftMissing, autoStart);
            } else if (actName.equals("GUI_ACTION")) {
                // craftconfirm等のmenuアクション (startJob/replan/back/cycleCpu)
                String name = params.get("name").getAsString();
                Class<?> gsp = Class.forName(
                    "appeng.core.sync.packets.GuiDataSyncPacket");
                pkt = gsp.getConstructor(int.class,
                        java.util.function.Consumer.class)
                    .newInstance(p.containerMenu.containerId,
                        (java.util.function.Consumer<
                            net.minecraft.network.FriendlyByteBuf>)
                        buf -> { buf.writeUtf(name); buf.writeUtf("null"); });
            } else if (params.has("serial")) {
                Object action = Enum.valueOf((Class) actCls, actName);
                long serial = params.get("serial").getAsLong();
                Class<?> pktCls = Class.forName(
                    "appeng.core.sync.packets.MEInteractionPacket");
                pkt = pktCls.getConstructor(int.class, long.class, actCls)
                    .newInstance(p.containerMenu.containerId, serial, action);
            } else {
                Object action = Enum.valueOf((Class) actCls, actName);
                int slot = params.get("slot").getAsInt();
                Class<?> pktCls = Class.forName(
                    "appeng.core.sync.packets.InventoryActionPacket");
                pkt = pktCls.getConstructor(actCls, int.class, long.class)
                    .newInstance(action, slot, 0L);
            }
            // BasePacket → vanilla Packet に変換して送信
            Class<?> dirCls = Class.forName("net.minecraftforge.network.NetworkDirection");
            Object toServer = Enum.valueOf((Class) dirCls.asSubclass(Enum.class),
                "PLAY_TO_SERVER");
            Object vanillaPkt = pkt.getClass().getMethod("toPacket", dirCls)
                .invoke(pkt, toServer);
            mc.getConnection().send((net.minecraft.network.protocol.Packet<?>) vanillaPkt);
            JsonObject r = new JsonObject();
            r.addProperty("action", params.get("action").getAsString());
            if (params.has("serial")) r.addProperty("serial", params.get("serial").getAsLong());
            if (params.has("slot")) r.addProperty("slot", params.get("slot").getAsInt());
            return r;
        } catch (ReflectiveOperationException e) {
            throw new ApiError("NOT_SUPPORTED", "no AE2 action API: " + e.getMessage());
        }
    }

    private static JsonObject inventoryResync() throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = requirePlayer();
        AbstractContainerMenu menu = p.containerMenu;
        // stateIdを不整合(-1)にしたクリックを送り、vanillaの復旧経路で
        // サーバー側 sendAllDataToRemote → コンテナ内容の全再送を引き出す。
        // slotNum=末尾外なので clicked() は何もせず、持ち物も動かない。
        net.minecraft.network.protocol.game.ServerboundContainerClickPacket pkt =
            new net.minecraft.network.protocol.game.ServerboundContainerClickPacket(
                menu.containerId, -1, menu.slots.size(), 0,
                ClickType.PICKUP, ItemStack.EMPTY,
                new it.unimi.dsi.fastutil.ints.Int2ObjectOpenHashMap<ItemStack>());
        mc.getConnection().send(pkt);
        JsonObject r = new JsonObject();
        r.addProperty("sent", true);
        r.addProperty("container_id", menu.containerId);
        return r;
    }

    private static JsonObject containerClose() throws ApiError {
        LocalPlayer p = requirePlayer();
        p.clientSideCloseContainer();
        JsonObject r = new JsonObject();
        r.addProperty("closed", true);
        return r;
    }

    /**
     * 成果物アイテムからレシピ解決。クライアント同期済みレシピマネージャを
     * 走査し {type, 材料, 投入数} を返す。機械系RecipeTypeも含む (FR-05)。
     */
    private static JsonObject recipeLookup(JsonObject params) throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        requirePlayer();
        String itemName = params.get("item").getAsString();
        ResourceLocation want = ResourceLocation.tryParse(itemName);
        if (want == null) throw new ApiError("BAD_REQUEST", "bad item id: " + itemName);
        JsonArray out = new JsonArray();
        if (mc.level != null && mc.getConnection() != null) {
            for (Recipe<?> rec : mc.getConnection().getRecipeManager().getRecipes()) {
                ItemStack res = rec.getResultItem(mc.level.registryAccess());
                ResourceLocation resId = BuiltInRegistries.ITEM.getKey(res.getItem());
                if (resId == null || !resId.equals(want)) continue;
                JsonObject o = new JsonObject();
                o.addProperty("id", rec.getId().toString());
                ResourceLocation t = BuiltInRegistries.RECIPE_TYPE.getKey(rec.getType());
                o.addProperty("type", t != null ? t.toString() : "unknown");
                if (rec instanceof net.minecraft.world.item.crafting.ShapedRecipe sh) {
                    o.addProperty("width", sh.getWidth());
                    o.addProperty("height", sh.getHeight());
                }
                JsonArray ings = new JsonArray();
                for (Ingredient ing : rec.getIngredients()) {
                    ItemStack[] opts = ing.getItems();
                    JsonObject io = new JsonObject();
                    if (opts.length == 0) {
                        io.addProperty("empty", true);
                    } else {
                        JsonArray ids = new JsonArray();
                        for (ItemStack it : opts) {
                            ResourceLocation iid = BuiltInRegistries.ITEM.getKey(it.getItem());
                            ids.add(iid != null ? iid.toString() : "unknown");
                        }
                        io.add("options", ids);
                        io.addProperty("count", opts[0].getCount());
                    }
                    ings.add(io);
                }
                o.add("ingredients", ings);
                JsonObject resObj = new JsonObject();
                resObj.addProperty("id", resId.toString());
                resObj.addProperty("count", res.getCount());
                o.add("result", resObj);
                out.add(o);
            }
        }
        JsonObject r = new JsonObject();
        r.addProperty("item", itemName);
        r.add("recipes", out);
        r.addProperty("count", out.size());
        return r;
    }

    /**
     * レシピ帳packetによる自動クラフト。現在開いているmenu
     * (InventoryMenu=2x2 または CraftingMenu=3x3) で実行する。
     * 対象レシピがプレイヤーのレシピ帳に未登録だとサーバーが弾く。
     */
    private static JsonObject craft(JsonObject params) throws ApiError {
        requirePlayer();
        String itemName = params.get("item").getAsString();
        int count = params.has("count") ? params.get("count").getAsInt() : 1;
        CraftTask t = new CraftTask(TaskManager.get().newId("craft"), itemName, count);
        TaskManager.get().register(t);
        JsonObject r = new JsonObject();
        r.addProperty("task_id", t.id);
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

    /**
     * 死亡画面からのリスポーン要求 (vanillaのリスポーンボタン相当)。
     * 生きている時に呼んでも害はない。
     */
    private static JsonObject respawn() throws ApiError {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null) throw new ApiError("NOT_IN_GAME", "no player");
        JsonObject r = new JsonObject();
        r.addProperty("was_alive", mc.player.isAlive());
        mc.getConnection().send(new net.minecraft.network.protocol.game
            .ServerboundClientCommandPacket(
                net.minecraft.network.protocol.game.ServerboundClientCommandPacket
                    .Action.PERFORM_RESPAWN));
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
        // JourneyMapがあれば同名waypointをミラー登録
        if (JourneyMapBridge.isAvailable()) {
            try {
                JourneyMapBridge.set(name, new BlockPos(x, y, z),
                    p.level().dimension());
                r.addProperty("journeymap", true);
            } catch (ReflectiveOperationException | NoClassDefFoundError e) {
                r.addProperty("journeymap_error", e.getMessage());
            }
        }
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
        if (JourneyMapBridge.isAvailable()) {
            try {
                r.addProperty("journeymap", JourneyMapBridge.del(name));
            } catch (ReflectiveOperationException | NoClassDefFoundError e) {
                r.addProperty("journeymap_error", e.getMessage());
            }
        }
        return r;
    }

    private static LocalPlayer requirePlayer() throws ApiError {
        LocalPlayer p = Minecraft.getInstance().player;
        if (p == null) throw new ApiError("NOT_IN_GAME", "player is not in a world");
        return p;
    }
}
