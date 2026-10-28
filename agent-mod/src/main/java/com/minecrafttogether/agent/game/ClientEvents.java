package com.minecrafttogether.agent.game;

import com.google.gson.JsonObject;
import com.minecrafttogether.agent.AgentConfig;
import com.minecrafttogether.agent.AgentMod;
import com.minecrafttogether.agent.net.AgentWsServer;
import com.minecrafttogether.agent.task.TaskManager;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.DisconnectedScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraftforge.client.event.ClientChatReceivedEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import com.google.gson.JsonArray;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.resources.ResourceLocation;

/**
 * ゲーム側イベント → WS evt 転送 + 自動サーバー接続。
 * いずれもメインスレッド上のイベントなのでそのまま扱える。
 */
public class ClientEvents {
    private long lastConnectAttempt = 0;

    // 相棒感イベント用トラッカー (ワールド外ではリセット)
    private float prevHealth = -1;
    private int dayPhase = -1;
    private Boolean wasRaining = null;
    private Set<String> nearbyPlayers = null;
    private Map<String, Integer> invSnapshot = null;
    private int tickCount = 0;

    /** 受信チャットを chat evt として bridge へ流す。自分の発言もここに来る (実ゲームのchat欄と同じ) */
    @SubscribeEvent
    public void onChat(ClientChatReceivedEvent event) {
        AgentWsServer ws = AgentMod.ws();
        if (ws == null) return;
        String from = "system";
        try {
            if (event.getBoundChatType() != null) {
                from = event.getBoundChatType().name().getString();
            }
        } catch (Exception ignored) {}
        JsonObject data = new JsonObject();
        data.addProperty("from", from);
        data.addProperty("text", event.getMessage().getString());
        ws.emit("chat", data);
        lookAtSpeaker(from);
    }

    /** プレイヤーが話したらその方向を向く。「こっちを見てる感」の最小実装 */
    private void lookAtSpeaker(String from) {
        if (!AgentConfig.autoLook() || "system".equals(from)) return;
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null || mc.level == null) return;
        if (from.equalsIgnoreCase(p.getGameProfile().getName())) return;
        try {
            for (Player speaker : mc.level.players()) {
                if (speaker != p && speaker.getGameProfile().getName().equalsIgnoreCase(from)) {
                    p.lookAt(net.minecraft.commands.arguments.EntityAnchorArgument.Anchor.EYES,
                        speaker.getEyePosition());
                    break;
                }
            }
        } catch (Exception ignored) {}
    }

    /**
     * 相棒感のための周囲イベント: damage/death (毎tick)、
     * 昼夜・天候・近傍プレイヤー出入り・インベントリ増加 (20tick毎)。
     */
    private void ambient(Minecraft mc) {
        LocalPlayer p = mc.player;
        AgentWsServer ws = AgentMod.ws();
        if (p == null || mc.level == null || ws == null) {
            prevHealth = -1;
            dayPhase = -1;
            wasRaining = null;
            nearbyPlayers = null;
            invSnapshot = null;
            return;
        }

        float h = p.getHealth();
        if (prevHealth >= 0 && h < prevHealth) {
            JsonObject d = new JsonObject();
            d.addProperty("health", h);
            d.addProperty("lost", Math.round((prevHealth - h) * 10.0) / 10.0);
            try {
                if (p.getLastDamageSource() != null)
                    d.addProperty("cause", p.getLastDamageSource().type().msgId());
            } catch (Exception ignored) {}
            ws.emit("damage", d);
        }
        if (prevHealth > 0 && h <= 0) ws.emit("death", new JsonObject());
        prevHealth = h;

        tickCount++;
        if (tickCount % 20 != 0) return;

        boolean isDay = mc.level.getDayTime() % 24000 < 12000;
        if (dayPhase != -1 && isDay != (dayPhase == 1)) {
            JsonObject d = new JsonObject();
            d.addProperty("phase", isDay ? "day" : "night");
            ws.emit("time", d);
        }
        dayPhase = isDay ? 1 : 0;

        boolean rain = mc.level.isRaining();
        if (wasRaining != null && rain != wasRaining) {
            JsonObject d = new JsonObject();
            d.addProperty("raining", rain);
            ws.emit("weather", d);
        }
        wasRaining = rain;

        Set<String> now = new TreeSet<>();
        for (Player pl : mc.level.players()) {
            if (pl != p) now.add(pl.getGameProfile().getName());
        }
        if (nearbyPlayers != null) {
            for (String n : now) {
                if (!nearbyPlayers.contains(n)) {
                    JsonObject d = new JsonObject();
                    d.addProperty("name", n);
                    d.addProperty("action", "appear");
                    ws.emit("player.nearby", d);
                }
            }
            for (String n : nearbyPlayers) {
                if (!now.contains(n)) {
                    JsonObject d = new JsonObject();
                    d.addProperty("name", n);
                    d.addProperty("action", "vanish");
                    ws.emit("player.nearby", d);
                }
            }
        }
        nearbyPlayers = now;

        Map<String, Integer> snap = new TreeMap<>();
        var inv = p.getInventory();
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack s = inv.getItem(i);
            if (s.isEmpty()) continue;
            ResourceLocation id = BuiltInRegistries.ITEM.getKey(s.getItem());
            if (id != null) snap.merge(id.toString(), s.getCount(), Integer::sum);
        }
        if (invSnapshot != null) {
            JsonArray gains = new JsonArray();
            for (Map.Entry<String, Integer> e : snap.entrySet()) {
                int delta = e.getValue() - invSnapshot.getOrDefault(e.getKey(), 0);
                if (delta > 0) {
                    JsonObject o = new JsonObject();
                    o.addProperty("id", e.getKey());
                    o.addProperty("count", delta);
                    gains.add(o);
                }
            }
            if (gains.size() > 0) {
                JsonObject d = new JsonObject();
                d.add("items", gains);
                ws.emit("pickup", d);
            }
        }
        invSnapshot = snap;
    }

    /** タイトル/切断画面に居る間は設定先サーバーへ自動接続を再試行する。また全タスクのtick駆動 */
    @SubscribeEvent
    public void onClientTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END) return;
        Minecraft mc = Minecraft.getInstance();
        ReflexGuard.tick(mc);
        TaskManager.get().tickAll();
        ambient(mc);
        if (!AgentConfig.autoConnect()) return;
        boolean atEntry = mc.screen instanceof TitleScreen || mc.screen instanceof DisconnectedScreen;
        long now = System.currentTimeMillis();
        if (!atEntry || now - lastConnectAttempt < 10_000) return;
        lastConnectAttempt = now;
        String target = AgentConfig.serverAddress();
        AgentMod.LOGGER.info("[agentmod] auto-connecting to {}", target);
        try {
            ServerAddress addr = ServerAddress.parseString(target);
            ServerData data = new ServerData("minecrafttogether", target, false);
            ConnectScreen.startConnecting(mc.screen, mc, addr, data, false);
        } catch (Exception e) {
            AgentMod.LOGGER.warn("[agentmod] auto-connect failed", e);
        }
    }
}
