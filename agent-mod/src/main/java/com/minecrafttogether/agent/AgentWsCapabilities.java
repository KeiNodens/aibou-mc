package com.minecrafttogether.agent.game;

import java.util.List;

/** meta.capabilities が返す対応method一覧。method実装と同期させること */
public final class AgentWsCapabilities {
    private AgentWsCapabilities() {}

    public static List<String> all() {
        return List.of(
            "meta.capabilities",
            "mod.ping",
            "chat.send",
            "chat.command",
            "obs.state",
            "obs.entity",
            "obs.scan",
            "obs.block",
            "obs.block_state",
            "look_info",
            "interact",
            "use_item",
            "container.read",
            "container.click",
            "container.button",
            "container.trade",
            "container.repo",
            "container.repo_action",
            "container.open_curios",
            "container.close",
            "inventory.resync",
            "recipe.lookup",
            "registry.blocks",
            "craft",
            "emote",
            "respawn",
            "screenshot",
            "find_item",
            "waypoint.set",
            "waypoint.get",
            "waypoint.list",
            "waypoint.del",
            "item.info",
            "quest.list",
            "quest.inspect",
            "quest.claim",
            "jei.search",
            "emi.search",
            "move.set",
            "move.stop",
            "key.list",
            "key",
            "scroll",
            "type",
            "sign.write",
            "screen.read",
            "screen.click",
            "screen.close",
            "look_at",
            "dig",
            "equip",
            "toss",
            "baritone.goto",
            "baritone.mine",
            "baritone.follow",
            "baritone.stop",
            "task.status",
            "task.result",
            "task.cancel",
            "task.cancel_all",
            "task.pause",
            "task.resume",
            "task.list"
        );
    }

    /**
     * observer接続に許可する読み取り専用method。
     * controller以外の接続はここに無いreqを拒否される (READONLY)。
     */
    public static final java.util.Set<String> READONLY = java.util.Set.of(
        "meta.capabilities", "mod.ping",
        "obs.state", "obs.entity", "obs.scan", "obs.block", "obs.block_state",
        "look_info", "container.read", "container.repo",
        "item.info", "find_item", "recipe.lookup", "registry.blocks",
        "waypoint.get", "waypoint.list",
        "quest.list", "quest.inspect", "screen.read",
        "task.status", "task.result", "task.list"
    );
}
