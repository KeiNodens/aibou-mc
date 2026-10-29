package com.minecrafttogether.agent;

/**
 * M1時点の簡易設定。環境変数またはシステムプロパティ (agentmod.*) で上書きする。
 * 後でForge configまたは専用ファイルに移す。
 */
public final class AgentConfig {
    private AgentConfig() {}

    public static int wsPort() {
        return intProp("agentmod.ws.port", "AGENTMOD_WS_PORT", 25587);
    }

    public static String serverAddress() {
        return prop("agentmod.server", "AGENTMOD_SERVER", "localhost:25565");
    }

    public static boolean autoConnect() {
        return boolProp("agentmod.autoconnect", "AGENTMOD_AUTOCONNECT", true);
    }

    /** プレイヤーの発言時に話者の方を向く */
    public static boolean autoLook() {
        return boolProp("agentmod.autolook", "AGENTMOD_AUTOLOOK", true);
    }

    // ---- 反射層 (ReflexGuard) ----

    public static boolean reflexEnabled() {
        return boolProp("agentmod.reflex.enabled", "AGENTMOD_REFLEX_ENABLED", true);
    }

    /** 残り酸素 (tick) がこれ未満で溺死回避 (max 300) */
    public static int reflexAirThreshold() {
        return intProp("agentmod.reflex.air", "AGENTMOD_REFLEX_AIR", 160);
    }

    /** このHP以下で退避 (20=max) */
    public static float reflexRetreatHp() {
        return floatProp("agentmod.reflex.retreat_hp", "AGENTMOD_REFLEX_RETREAT_HP", 8.0f);
    }

    /** 近傍の敵性mobがこの数以上で退避 */
    public static int reflexRetreatHostiles() {
        return intProp("agentmod.reflex.retreat_hostiles",
            "AGENTMOD_REFLEX_RETREAT_HOSTILES", 3);
    }

    public static int reflexRetreatCooldownMs() {
        return intProp("agentmod.reflex.retreat_cooldown",
            "AGENTMOD_REFLEX_RETREAT_COOLDOWN", 60_000);
    }

    /** 満腹度がこの値以下で自動食事 */
    public static int reflexEatFood() {
        return intProp("agentmod.reflex.eat_food", "AGENTMOD_REFLEX_EAT_FOOD", 12);
    }

    public static int reflexEatCooldownMs() {
        return intProp("agentmod.reflex.eat_cooldown",
            "AGENTMOD_REFLEX_EAT_COOLDOWN", 60_000);
    }

    public static int reflexSleepCooldownMs() {
        return intProp("agentmod.reflex.sleep_cooldown",
            "AGENTMOD_REFLEX_SLEEP_COOLDOWN", 120_000);
    }

    /** 退避・帰還先のwaypoint名 */
    public static String reflexHome() {
        return prop("agentmod.reflex.home", "AGENTMOD_REFLEX_HOME", "home");
    }

    /** respawn後にhomeへ帰還するか */
    public static boolean reflexReturnAfterDeath() {
        return boolProp("agentmod.reflex.return_after_death",
            "AGENTMOD_REFLEX_RETURN", true);
    }

    /** combat.mode: normal=閾値で退避 / death=絶対退避しない */
    public static boolean combatDeathMode() {
        return "death".equalsIgnoreCase(
            prop("agentmod.combat.mode", "AGENTMOD_COMBAT_MODE", "normal"));
    }

    /** sleep同期の対象プレイヤー名。空=任意の他プレイヤー */
    public static String ownerName() {
        return prop("agentmod.owner", "AGENTMOD_OWNER", "");
    }

    /** 自律レベル (0=指示のみ 1=提案 2=自律)。mod側はhelloで公開するだけ */
    public static int autonomyLevel() {
        return intProp("agentmod.autonomy", "AGENTMOD_AUTONOMY", 1);
    }

    /** プロファイル (survival/operator)。helloで公開しbridge側の既定値と揃える */
    public static String profile() {
        return prop("agentmod.profile", "AGENTMOD_PROFILE", "survival");
    }

    private static String prop(String sysProp, String env, String def) {
        String v = System.getProperty(sysProp);
        if (v == null) v = System.getenv(env);
        return v != null && !v.isBlank() ? v : def;
    }

    private static int intProp(String sysProp, String env, int def) {
        try {
            return Integer.parseInt(prop(sysProp, env, String.valueOf(def)));
        } catch (NumberFormatException e) {
            return def;
        }
    }

    private static float floatProp(String sysProp, String env, float def) {
        try {
            return Float.parseFloat(prop(sysProp, env, String.valueOf(def)));
        } catch (NumberFormatException e) {
            return def;
        }
    }

    private static boolean boolProp(String sysProp, String env, boolean def) {
        String v = prop(sysProp, env, null);
        return v == null ? def : Boolean.parseBoolean(v);
    }
}
