package com.minecrafttogether.agent.game;

/**
 * 反射の発火判定 (Minecraft非依存の純粋ロジック)。
 * ReflexGuardが毎tickスナップショットを作って decide() に渡し、
 * 返ってきたKindに応じてMC依存の発動を行う。
 * MC参照を持たないため JUnit で単体テストできる (policy単位テスト)。
 */
public final class ReflexPolicy {
    private ReflexPolicy() {}

    public enum Kind { NONE, DROWN, RETREAT, EAT, SLEEP, RETURN }

    /** 閾値・クールダウン・モード設定 */
    public record Cfg(
        int airThreshold,       // 残り酸素 (tick) がこれ未満で溺死回避
        float retreatHp,        // このHP以下で退避
        int retreatHostiles,    // この敵数以上で退避 (death mode時は不発)
        long retreatCooldownMs,
        int eatFood,            // 満腹度がこの値以下で食事
        long eatCooldownMs,
        long sleepCooldownMs,
        boolean combatDeathMode, // death=絶対退避しない
        boolean returnAfterDeath) {}

    /** 発火評価に必要な状態のスナップショット */
    public record In(
        double health, int hunger, int air,
        int hostiles, boolean inHome, boolean alreadyRetreating,
        boolean ownerSleeping, boolean anyUserTaskRunning,
        boolean justRespawned, boolean eatCapable,
        long now, long lastEatAt, long lastRetreatAt,
        long lastSleepTryAt, long lastReturnAt) {}

    /** 優先度: 溺死 > 退避 > 食事 > 睡眠同期 > 死亡後帰還 */
    public static Kind decide(In in, Cfg c) {
        if (in.air < c.airThreshold) return Kind.DROWN;
        if (!c.combatDeathMode && !in.inHome && !in.alreadyRetreating
            && in.now - in.lastRetreatAt >= c.retreatCooldownMs
            && (in.health <= c.retreatHp || in.hostiles >= c.retreatHostiles))
            return Kind.RETREAT;
        if (in.eatCapable && in.hunger <= c.eatFood
            && in.now - in.lastEatAt >= c.eatCooldownMs)
            return Kind.EAT;
        if (in.ownerSleeping && !in.anyUserTaskRunning
            && in.now - in.lastSleepTryAt >= c.sleepCooldownMs)
            return Kind.SLEEP;
        if (in.justRespawned && c.returnAfterDeath
            && in.now - in.lastReturnAt >= c.retreatCooldownMs)
            return Kind.RETURN;
        return Kind.NONE;
    }
}
