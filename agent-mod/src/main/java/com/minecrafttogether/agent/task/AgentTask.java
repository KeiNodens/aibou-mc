package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;

/** 長時間動作タスク。tickはクライアントメインスレッドのClientTickEventから駆動する */
public abstract class AgentTask {
    public enum State { QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLING, CANCELLED }

    public final String id;
    public State state = State.QUEUED;
    public JsonObject result;
    public String errorCode;
    public String errorMessage;

    protected AgentTask(String id) { this.id = id; }

    /** 毎tick呼ばれる。完了時に state を遷移させる */
    public abstract void tick();

    /** task.cancel 受理時。実際の停止処理を行い state=CANCELLED にする */
    public void cancel() {
        this.state = State.CANCELLED;
    }

    public String stateName() {
        return switch (state) {
            case QUEUED -> "queued";
            case RUNNING -> "running";
            case SUCCEEDED -> "succeeded";
            case FAILED -> "failed";
            case CANCELLING -> "cancelling";
            case CANCELLED -> "cancelled";
        };
    }

    public boolean done() {
        return state == State.SUCCEEDED || state == State.FAILED
            || state == State.CANCELLED;
    }
}
