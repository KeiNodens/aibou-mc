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

    private static boolean boolProp(String sysProp, String env, boolean def) {
        String v = prop(sysProp, env, null);
        return v == null ? def : Boolean.parseBoolean(v);
    }
}
