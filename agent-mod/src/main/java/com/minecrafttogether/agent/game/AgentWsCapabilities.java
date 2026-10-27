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
            "use_item",
            "container.read",
            "container.click",
            "container.close",
            "recipe.lookup",
            "craft",
            "emote",
            "screenshot",
            "find_item",
            "waypoint.set",
            "waypoint.get",
            "waypoint.list",
            "waypoint.del",
            "move.set",
            "move.stop",
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
            "task.cancel_all"
        );
    }
}
