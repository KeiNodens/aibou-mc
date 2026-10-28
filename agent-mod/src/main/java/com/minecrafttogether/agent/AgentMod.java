package com.minecrafttogether.agent;

import com.minecrafttogether.agent.game.ClientEvents;
import com.minecrafttogether.agent.net.AgentWsServer;
import com.mojang.logging.LogUtils;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.loading.FMLEnvironment;
import org.slf4j.Logger;
import org.spongepowered.asm.mixin.Mixins;

/**
 * MinecraftTogether Agent (client-side only mod).
 *
 * <p>localhostのWebSocketサーバーを立て、bridge (MCPサーバー) からの
 * JSON-RPC風リクエストをゲームメインスレッドに引き渡して実行する。
 * プロトコル: docs/design.md §2.3</p>
 */
@Mod(AgentMod.MOD_ID)
public class AgentMod {
    public static final String MOD_ID = "agentmod";
    public static final Logger LOGGER = LogUtils.getLogger();

    private static AgentWsServer wsServer;

    public AgentMod() {
        // クライアント専用mod。サーバー側では一切動かない
        if (FMLEnvironment.dist != Dist.CLIENT) {
            LOGGER.warn("agentmod is a client-only mod; skipping init on server side");
            return;
        }
        // Forge 47.xはmods.tomlの[[mixins]]を読まないため明示登録。
        // config自体はrequired:falseなのでsolapplepie無しでも安全
        Mixins.addConfiguration("agentmod.mixins.json");
        MinecraftForge.EVENT_BUS.register(new ClientEvents());
        startWs();
    }

    private void startWs() {
        int port = AgentConfig.wsPort();
        try {
            wsServer = new AgentWsServer(port);
            wsServer.setReuseAddr(true);
            wsServer.start();
            LOGGER.info("[agentmod] WS server listening on ws://127.0.0.1:{}", port);
        } catch (Exception e) {
            LOGGER.error("[agentmod] failed to start WS server", e);
        }
    }

    public static AgentWsServer ws() {
        return wsServer;
    }
}
