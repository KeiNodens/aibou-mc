package com.minecrafttogether.agent.net;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.minecrafttogether.agent.AgentConfig;
import com.minecrafttogether.agent.AgentMod;
import com.minecrafttogether.agent.game.AgentWsCapabilities;
import com.minecrafttogether.agent.game.GameOps;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.Random;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

/**
 * design §2.3 のWS/JSON-RPC風プロトコル。
 * - bridge がクライアントとして接続する
 * - 接続時に hello {generation, capabilities} を送る
 * - req の実行は必ずゲームメインスレッド (Minecraft#execute) に引き渡す
 */
public class AgentWsServer extends WebSocketServer {
    private final int generation = new Random().nextInt(Integer.MAX_VALUE) + 1;

    private static final List<String> CAPABILITIES = AgentWsCapabilities.all();

    public AgentWsServer(int port) {
        super(new InetSocketAddress("127.0.0.1", port));
    }

    public int generation() {
        return generation;
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        JsonObject hello = new JsonObject();
        hello.addProperty("type", "hello");
        hello.addProperty("generation", generation);
        hello.addProperty("mod_version", "0.1.0");
        JsonArray caps = new JsonArray();
        CAPABILITIES.forEach(caps::add);
        hello.add("capabilities", caps);
        conn.send(hello.toString());
        AgentMod.LOGGER.info("[agentmod] bridge connected");
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        JsonObject msg;
        try {
            msg = JsonParser.parseString(message).getAsJsonObject();
        } catch (Exception e) {
            return;
        }
        if (!msg.has("type") || !"req".equals(msg.get("type").getAsString())) return;
        long id = msg.has("id") ? msg.get("id").getAsLong() : -1;
        String method = msg.has("method") ? msg.get("method").getAsString() : "";
        JsonObject params = msg.has("params") && msg.get("params").isJsonObject()
            ? msg.getAsJsonObject("params") : new JsonObject();

        if (!CAPABILITIES.contains(method)) {
            fail(conn, id, "UNSUPPORTED", "method " + method + " not supported by agentmod");
            return;
        }

        // WSスレッドから直接ゲーム状態に触れない。メインスレッドへ引き渡す (design §2.1)
        net.minecraft.client.Minecraft.getInstance().execute(() -> {
            try {
                Object result = GameOps.dispatch(method, params);
                if (result instanceof java.util.concurrent.CompletionStage<?> fut) {
                    // screenshot等: レンダースレッド完了後に応答する
                    fut.whenComplete((r, ex) -> {
                        if (ex == null) ok(conn, id, (JsonObject) r);
                        else fail(conn, id, "INTERNAL", String.valueOf(ex));
                    });
                } else {
                    ok(conn, id, (JsonObject) result);
                }
            } catch (GameOps.ApiError e) {
                fail(conn, id, e.code(), e.getMessage());
            } catch (Exception e) {
                fail(conn, id, "INTERNAL", String.valueOf(e));
            }
        });
    }

    /** evt を全bridge接続へブロードキャストする */
    public void emit(String name, JsonObject data) {
        JsonObject evt = new JsonObject();
        evt.addProperty("type", "evt");
        evt.addProperty("name", name);
        evt.add("data", data);
        broadcast(evt.toString());
    }

    private void ok(WebSocket conn, long id, JsonObject result) {
        JsonObject res = new JsonObject();
        res.addProperty("type", "res");
        res.addProperty("id", id);
        res.addProperty("ok", true);
        res.add("result", result);
        conn.send(res.toString());
    }

    private void fail(WebSocket conn, long id, String code, String message) {
        JsonObject err = new JsonObject();
        err.addProperty("code", code);
        err.addProperty("message", message);
        JsonObject res = new JsonObject();
        res.addProperty("type", "res");
        res.addProperty("id", id);
        res.addProperty("ok", false);
        res.add("error", err);
        conn.send(res.toString());
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        AgentMod.LOGGER.info("[agentmod] bridge disconnected ({})", code);
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        AgentMod.LOGGER.warn("[agentmod] ws error", ex);
    }

    @Override
    public void onStart() {
        AgentMod.LOGGER.info("[agentmod] ws ready, autoconnect={} server={}",
            AgentConfig.autoConnect(), AgentConfig.serverAddress());
    }
}
