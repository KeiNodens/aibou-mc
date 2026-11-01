package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;
import com.minecrafttogether.agent.AgentMod;
import com.minecrafttogether.agent.net.AgentWsServer;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * タスクの状態管理 (design §2.3): task_id・状態照会・停止完了・結果一時保持。
 * 全処理はクライアントメインスレッド (tick) 上で行う。
 */
public class TaskManager {
    private static final int MAX_KEPT = 128;

    private static final TaskManager INSTANCE = new TaskManager();

    private final AtomicInteger seq = new AtomicInteger();
    private final Map<String, AgentTask> tasks = new LinkedHashMap<>();
    private final Deque<String> order = new ArrayDeque<>();

    public static TaskManager get() { return INSTANCE; }

    public String newId(String prefix) {
        return prefix + "-t" + seq.incrementAndGet();
    }

    public void register(AgentTask t) {
        // D59/P2-5: 移動系 (Baritone) タスクは単一排他。同時に走ると
        // 後発が Baritone の cancelEverything で先行を殺し合った。
        // 2件目は即 BUSY 失敗にする (bridge のスキル排他と同じ意味論)。
        // 反射タスク (reflex-*) は安全系なので先行を cancel して割り込む
        if (t.movementTask()) {
            for (AgentTask o : tasks.values()) {
                if (o == t || !o.movementTask() || o.done()) continue;
                if (o.state != AgentTask.State.RUNNING
                    && o.state != AgentTask.State.QUEUED
                    && o.state != AgentTask.State.PAUSED) continue;
                if (t.id.startsWith("reflex-")) {
                    o.cancel();
                } else {
                    t.state = AgentTask.State.FAILED;
                    t.errorCode = "BUSY";
                    t.errorMessage = "movement task already running: " + o.id;
                }
                break;
            }
        }
        tasks.put(t.id, t);
        order.addLast(t.id);
        // D59/P2-6: 追放は終了済みタスクだけ。実行中タスクを追うと
        // 照会キーを保持する呼び出し側が孤児化した。全て実行中なら
        // 上限超過を許す (保持はメモリのみで実害が小さい)
        while (order.size() > MAX_KEPT) {
            String evict = null;
            for (String id : order) {
                AgentTask o = tasks.get(id);
                if (o != null && o.done()) { evict = id; break; }
            }
            if (evict == null) break;
            order.remove(evict);
            tasks.remove(evict);
            notified.remove(evict);
        }
    }

    public AgentTask find(String id) {
        AgentTask t = tasks.get(id);
        return t != null && t.id.equals(id) ? t : null;
    }

    public java.util.Collection<AgentTask> all() {
        return tasks.values();
    }

    /** ClientTickEvent ENDから呼ぶ。全タスクを進め、終了したらtask.doneをemit */
    public void tickAll() {
        for (AgentTask t : tasks.values()) {
            if (t.state == AgentTask.State.QUEUED) t.state = AgentTask.State.RUNNING;
            if (t.state == AgentTask.State.RUNNING || t.state == AgentTask.State.CANCELLING) {
                try {
                    t.tick();
                } catch (Exception e) {
                    t.state = AgentTask.State.FAILED;
                    t.errorCode = "INTERNAL";
                    t.errorMessage = String.valueOf(e);
                }
            }
            // postcondition: SUCCEEDED宣言直後に実世界状態を1回だけ照合する。
            // 「API呼出が通った」だけでは目標達成とみなさない (P3)
            if (t.state == AgentTask.State.SUCCEEDED
                && t.postcondition != null && !t.postChecked) {
                t.postChecked = true;
                boolean ok;
                try {
                    ok = t.postcondition.getAsBoolean();
                } catch (Exception e) {
                    ok = false;
                }
                if (!ok) {
                    t.state = AgentTask.State.FAILED;
                    t.errorCode = "POSTCONDITION";
                    t.errorMessage = "postcondition failed"
                        + (t.postconditionDesc != null ? ": " + t.postconditionDesc : "");
                }
            }
            if (t.done() && notified.add(t.id)) {
                emitDone(t);
            }
        }
    }

    private final java.util.Set<String> notified = new java.util.HashSet<>();

    private void emitDone(AgentTask t) {
        AgentWsServer ws = AgentMod.ws();
        if (ws == null) return;
        JsonObject data = new JsonObject();
        data.addProperty("task_id", t.id);
        data.addProperty("state", t.stateName());
        if (t.result != null) data.add("result", t.result);
        if (t.errorCode != null) {
            JsonObject err = new JsonObject();
            err.addProperty("code", t.errorCode);
            err.addProperty("message", t.errorMessage);
            data.add("error", err);
            // task_status/task_result と同じflat名でも出す (skill側はこちらを読む)
            data.addProperty("error_code", t.errorCode);
            data.addProperty("error_message", t.errorMessage);
        }
        ws.emit("task.done", data);
    }

    public JsonObject statusJson(AgentTask t) {
        JsonObject r = new JsonObject();
        r.addProperty("task_id", t.id);
        r.addProperty("generation", AgentMod.ws() != null ? AgentMod.ws().generation() : 0);
        r.addProperty("state", t.stateName());
        if (t.result != null) r.add("result", t.result);
        if (t.errorCode != null) r.addProperty("error_code", t.errorCode);
        if (t.errorMessage != null) r.addProperty("error_message", t.errorMessage);
        return r;
    }
}
