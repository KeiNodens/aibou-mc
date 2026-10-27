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
        tasks.put(t.id, t);
        order.addLast(t.id);
        while (order.size() > MAX_KEPT) {
            String evicted = order.pollFirst();
            tasks.remove(evicted);
            notified.remove(evicted);
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
