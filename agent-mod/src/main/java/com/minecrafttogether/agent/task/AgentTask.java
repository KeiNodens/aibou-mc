package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;
import java.util.function.BooleanSupplier;

/** 長時間動作タスク。tickはクライアントメインスレッドのClientTickEventから駆動する */
public abstract class AgentTask {
    public enum State { QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLING, CANCELLED, PAUSED }

    public final String id;
    public State state = State.QUEUED;
    public JsonObject result;
    public String errorCode;
    public String errorMessage;

    /**
     * 成功宣言時の事後条件 (postcondition)。non-nullなら、SUCCEEDED遷移直後に
     * TaskManagerが1回だけ評価する。falseなら実世界状態が期待と合わないとして
     * FAILED(POSTCONDITION) に落とす — 「API呼出が通った≠目標達成」対策。
     * メインスレッドで評価されるのでMinecraft状態を直接読んでよい。
     */
    public BooleanSupplier postcondition;
    public String postconditionDesc;
    boolean postChecked;

    protected AgentTask(String id) { this.id = id; }

    /** Baritone を使う移動系タスクか。TaskManager が単一排他を課す (D59/P2-5) */
    public boolean movementTask() { return false; }

    /** 毎tick呼ばれる。完了時に state を遷移させる */
    public abstract void tick();

    /** task.cancel 受理時。実際の停止処理を行い state=CANCELLED にする */
    public void cancel() {
        this.state = State.CANCELLED;
    }

    /** task.pause/resume。進行中動作の実停止/再開はサブクラスがonPause/onResumeで */
    public void pause() {
        if (state == State.RUNNING || state == State.QUEUED) {
            state = State.PAUSED;
            onPause();
        }
    }

    public void resume() {
        if (state == State.PAUSED) {
            state = State.RUNNING;
            onResume();
        }
    }

    /** pause時に動作実体 (Baritone等) を止める。デフォルトは何もしない */
    protected void onPause() {}

    /** resume時に動作実体を再開する。デフォルトは何もしない */
    protected void onResume() {}

    public String stateName() {
        return switch (state) {
            case QUEUED -> "queued";
            case RUNNING -> "running";
            case SUCCEEDED -> "succeeded";
            case FAILED -> "failed";
            case CANCELLING -> "cancelling";
            case CANCELLED -> "cancelled";
            case PAUSED -> "paused";
        };
    }

    public boolean done() {
        return state == State.SUCCEEDED || state == State.FAILED
            || state == State.CANCELLED;
    }
}
