package com.minecrafttogether.agent.game;

import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;

/** ReflexPolicyのpolicy単位テスト (MC非依存)。発火条件とcooldown・modeの判定を固定する */
class ReflexPolicyTest {
    private static final ReflexPolicy.Cfg CFG = new ReflexPolicy.Cfg(
        160,   // airThreshold
        8.0f,  // retreatHp
        3,     // retreatHostiles
        60_000,// retreatCooldownMs
        12,    // eatFood
        60_000,// eatCooldownMs
        120_000,// sleepCooldownMs
        false, // combatDeathMode
        true); // returnAfterDeath

    private static ReflexPolicy.In base() {
        // 全条件が不発の「平常」スナップショット
        return new ReflexPolicy.In(
            20.0, 20, 300, 0, false, false,
            false, false, false, true,
            100_000L, 0L, 0L, 0L, 0L);
    }

    @Test
    void normalStateIsNone() {
        assertEquals(ReflexPolicy.Kind.NONE, ReflexPolicy.decide(base(), CFG));
    }

    @Test
    void lowAirIsDrown() {
        var in = new ReflexPolicy.In(
            20.0, 20, 100, 0, false, false,
            false, false, false, true,
            100_000L, 0L, 0L, 0L, 0L);
        assertEquals(ReflexPolicy.Kind.DROWN, ReflexPolicy.decide(in, CFG));
    }

    @Test
    void lowHpIsRetreat() {
        var in = new ReflexPolicy.In(
            7.0, 20, 300, 0, false, false,
            false, false, false, true,
            100_000L, 0L, 0L, 0L, 0L);
        assertEquals(ReflexPolicy.Kind.RETREAT, ReflexPolicy.decide(in, CFG));
    }

    @Test
    void hostilesCountTriggersRetreat() {
        var in = new ReflexPolicy.In(
            20.0, 20, 300, 3, false, false,
            false, false, false, true,
            100_000L, 0L, 0L, 0L, 0L);
        assertEquals(ReflexPolicy.Kind.RETREAT, ReflexPolicy.decide(in, CFG));
    }

    @Test
    void homeAreaSuppressesRetreat() {
        var in = new ReflexPolicy.In(
            7.0, 20, 300, 3, true, false,
            false, false, false, true,
            100_000L, 0L, 0L, 0L, 0L);
        assertEquals(ReflexPolicy.Kind.NONE, ReflexPolicy.decide(in, CFG));
    }

    @Test
    void deathModeSuppressesRetreat() {
        var deathCfg = new ReflexPolicy.Cfg(
            160, 8.0f, 3, 60_000, 12, 60_000, 120_000, true, true);
        var in = new ReflexPolicy.In(
            2.0, 20, 300, 5, false, false,
            false, false, false, true,
            100_000L, 0L, 0L, 0L, 0L);
        assertEquals(ReflexPolicy.Kind.NONE, ReflexPolicy.decide(in, deathCfg));
    }

    @Test
    void retreatCooldown() {
        var in = new ReflexPolicy.In(
            7.0, 20, 300, 0, false, false,
            false, false, false, true,
            100_000L, 0L, 90_000L, 0L, 0L); // lastRetreat 10s前 < 60s cooldown
        assertEquals(ReflexPolicy.Kind.NONE, ReflexPolicy.decide(in, CFG));
    }

    @Test
    void hungryEats() {
        var in = new ReflexPolicy.In(
            20.0, 10, 300, 0, false, false,
            false, false, false, true,
            100_000L, 0L, 0L, 0L, 0L);
        assertEquals(ReflexPolicy.Kind.EAT, ReflexPolicy.decide(in, CFG));
    }

    @Test
    void eatCapableFalseSuppressesEat() {
        var in = new ReflexPolicy.In(
            20.0, 10, 300, 0, false, false,
            false, false, false, false, // eatCapable=false
            100_000L, 0L, 0L, 0L, 0L);
        assertEquals(ReflexPolicy.Kind.NONE, ReflexPolicy.decide(in, CFG));
    }

    @Test
    void eatCooldown() {
        var in = new ReflexPolicy.In(
            20.0, 10, 300, 0, false, false,
            false, false, false, true,
            100_000L, 90_000L, 0L, 0L, 0L); // lastEat 10s前
        assertEquals(ReflexPolicy.Kind.NONE, ReflexPolicy.decide(in, CFG));
    }

    @Test
    void ownerSleepingTriggersSleep() {
        var in = new ReflexPolicy.In(
            20.0, 20, 300, 0, false, false,
            true, false, false, true,
            200_000L, 0L, 0L, 0L, 0L); // sleepCooldown(120s)超過
        assertEquals(ReflexPolicy.Kind.SLEEP, ReflexPolicy.decide(in, CFG));
    }

    @Test
    void sleepSkippedWhenUserTaskRunning() {
        var in = new ReflexPolicy.In(
            20.0, 20, 300, 0, false, false,
            true, true, false, true, // 作業中は非強制
            200_000L, 0L, 0L, 0L, 0L);
        assertEquals(ReflexPolicy.Kind.NONE, ReflexPolicy.decide(in, CFG));
    }

    @Test
    void respawnTriggersReturn() {
        var in = new ReflexPolicy.In(
            20.0, 20, 300, 0, false, false,
            false, false, true, true,
            100_000L, 0L, 0L, 0L, 0L);
        assertEquals(ReflexPolicy.Kind.RETURN, ReflexPolicy.decide(in, CFG));
    }

    @Test
    void drownBeatsEverything() {
        var in = new ReflexPolicy.In(
            5.0, 5, 50, 5, false, false,
            true, false, true, true,
            100_000L, 0L, 0L, 0L, 0L);
        assertEquals(ReflexPolicy.Kind.DROWN, ReflexPolicy.decide(in, CFG));
    }
}
