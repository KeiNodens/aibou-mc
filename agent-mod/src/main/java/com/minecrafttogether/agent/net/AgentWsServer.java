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
import java.util.Locale;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Random;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.java_websocket.WebSocket;
import org.java_websocket.drafts.Draft;
import org.java_websocket.exceptions.InvalidDataException;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.handshake.ServerHandshakeBuilder;
import org.java_websocket.server.WebSocketServer;

/**
 * design §2.3 のWS/JSON-RPC風プロトコル。
 * - bridge がクライアントとして接続する
 * - 接続時に hello {generation, capabilities} を送る
 * - req の実行は必ずゲームメインスレッド (Minecraft#execute) に引き渡す
 *
 * 堅牢化 (P3):
 * - bindはloopback固定 + リモートがloopbackでなければ 1008 で拒否
 * - Originヘッダーがあればlocalhost系以外をHTTP 403で拒否 (ブラウザ経由のCSRF対策)
 * - hello後10秒以内に {type:"identify", role} が無ければ 1002 で切断
 * - role=observer は読み取り専用methodのみ許可 (AgentWsCapabilities.READONLY)
 * - 1フレーム64KiB超は 1009 で切断
 */
public class AgentWsServer extends WebSocketServer {
    private final int generation = new Random().nextInt(Integer.MAX_VALUE) + 1;

    private static final List<String> CAPABILITIES = AgentWsCapabilities.all();
    private static final int MAX_FRAME = 64 * 1024;
    private static final long IDENTIFY_TIMEOUT_MS = 10_000;

    // identifyタイムアウト監視用 (daemon。Minecraftスレッドを汚さない)
    private static final ScheduledExecutorService TIMER =
        Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "agentmod-ws-timer");
            t.setDaemon(true);
            return t;
        });

    public AgentWsServer(int port) {
        super(new InetSocketAddress("127.0.0.1", port));
    }

    public int generation() {
        return generation;
    }

    @Override
    public ServerHandshakeBuilder onWebsocketHandshakeReceivedAsServer(
            WebSocket conn, Draft draft, ClientHandshake request)
            throws InvalidDataException {
        ServerHandshakeBuilder b =
            super.onWebsocketHandshakeReceivedAsServer(conn, draft, request);
        // Originがあればlocalhost系のみ許可。無いもの (Node ws等) は許可
        String origin = request.getFieldValue("Origin");
        if (origin != null && !origin.isEmpty()) {
            // Review S1: prefix matching let http://localhost.attacker.example
            // through. Parse the URI and require an exact loopback host.
            boolean ok = false;
            try {
                URI u = new URI(origin.trim());
                String scheme = u.getScheme();
                String host = u.getHost();
                if (scheme != null && host != null
                        && (scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
                    String h = host.toLowerCase(Locale.ROOT);
                    ok = h.equals("localhost") || h.equals("127.0.0.1") || h.equals("::1");
                }
            } catch (URISyntaxException e) {
                ok = false;
            }
            if (!ok) {
                b.setHttpStatus((short) 403);
                b.setHttpStatusMessage("Forbidden");
                AgentMod.LOGGER.warn("[agentmod] rejected origin: {}", origin);
            }
        }
        return b;
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        // loopback以外からの接続はここでも拒否 (bind済みだが多層防御)
        InetSocketAddress remote = conn.getRemoteSocketAddress();
        if (remote != null && remote.getAddress() != null
            && !remote.getAddress().isLoopbackAddress()) {
            AgentMod.LOGGER.warn("[agentmod] rejected non-loopback remote: {}", remote);
            conn.close(1008, "loopback only");
            return;
        }

        JsonObject hello = new JsonObject();
        hello.addProperty("type", "hello");
        hello.addProperty("generation", generation);
        hello.addProperty("mod_version", "0.1.0");
        hello.addProperty("autonomy", AgentConfig.autonomyLevel());
        hello.addProperty("profile", AgentConfig.profile());
        JsonArray caps = new JsonArray();
        CAPABILITIES.forEach(caps::add);
        hello.add("capabilities", caps);
        conn.send(hello.toString());

        // identifyタイムアウト: 10秒以内にrole申告が無ければ切断
        TIMER.schedule(() -> {
            if (conn.isOpen() && conn.<String>getAttachment() == null) {
                AgentMod.LOGGER.warn("[agentmod] identify timeout; closing");
                conn.close(1002, "identify timeout");
            }
        }, IDENTIFY_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        AgentMod.LOGGER.info("[agentmod] bridge connected");
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        if (message.length() > MAX_FRAME) {
            AgentMod.LOGGER.warn("[agentmod] frame too large ({}B); closing",
                message.length());
            conn.close(1009, "frame too large");
            return;
        }
        JsonObject msg;
        try {
            msg = JsonParser.parseString(message).getAsJsonObject();
        } catch (Exception e) {
            return;
        }
        if (!msg.has("type")) return;
        String type = msg.get("type").getAsString();

        // identify: role申告。controller=全method、observer=READONLYのみ
        // D59/P1-5: 未知・省略の role は controller へ倒さず切断する
        // (fail-closed)。旧実装は typo や省略でも全権の controller に
        // なった。再 identify による role 昇格も許さない
        if ("identify".equals(type)) {
            if (conn.<String>getAttachment() != null) {
                AgentMod.LOGGER.warn("[agentmod] re-identify ignored");
                return;
            }
            String role = null;
            if (msg.has("role") && msg.get("role").isJsonPrimitive()) {
                String r = msg.get("role").getAsString();
                if ("controller".equals(r) || "observer".equals(r)) role = r;
            }
            if (role == null) {
                AgentMod.LOGGER.warn("[agentmod] identify with missing/unknown role; closing");
                conn.close(1002, "identify requires role controller|observer");
                return;
            }
            conn.setAttachment(role);
            JsonObject ack = new JsonObject();
            ack.addProperty("type", "identified");
            ack.addProperty("role", role);
            conn.send(ack.toString());
            AgentMod.LOGGER.info("[agentmod] identified as {}", role);
            return;
        }
        if (!"req".equals(type)) return;

        String role = conn.getAttachment();
        if (role == null) {
            // 未identifyのreqは拒否 (旧bridge互換はidentify不要期間で移行済み想定)
            long id = msg.has("id") ? msg.get("id").getAsLong() : -1;
            fail(conn, id, "NOT_IDENTIFIED", "send {type:identify, role} first");
            return;
        }

        long id = msg.has("id") ? msg.get("id").getAsLong() : -1;
        String method = msg.has("method") ? msg.get("method").getAsString() : "";
        JsonObject params = msg.has("params") && msg.get("params").isJsonObject()
            ? msg.getAsJsonObject("params") : new JsonObject();

        if ("observer".equals(role) && !AgentWsCapabilities.READONLY.contains(method)) {
            fail(conn, id, "OBSERVER_READONLY",
                "observer cannot call " + method);
            return;
        }

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

    /**
     * evt を全bridge接続へブロードキャストする。
     * 遅い接続の背圧はjava-websocketの内部キューとTCP flow controlに委ねる
     * (送信失敗時は接続が閉じられreconnectされる運用)。
     */
    public void emit(String name, JsonObject data) {
        JsonObject evt = new JsonObject();
        evt.addProperty("type", "evt");
        evt.addProperty("name", name);
        evt.add("data", data);
        // D59/P1-5: evt は identify 済み接続にだけ流す (旧実装は
        // broadcast で未 identify の接続にも chat 等が届いていた)
        String s = evt.toString();
        for (WebSocket c : getConnections()) {
            if (c.isOpen() && c.<String>getAttachment() != null) c.send(s);
        }
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
