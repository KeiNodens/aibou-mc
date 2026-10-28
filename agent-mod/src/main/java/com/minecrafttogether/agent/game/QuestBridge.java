package com.minecrafttogether.agent.game;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraftforge.fml.ModList;

/**
 * FTB Quests連携の隔離層 (全リフレクション)。
 * ClientQuestFile.INSTANCE はサーバー同期後にのみ存在する。
 * クエスト定義がパックに無い環境では空リストを返す。
 */
public final class QuestBridge {
    private QuestBridge() {}

    public static boolean isAvailable() {
        return ModList.get().isLoaded("ftbquests");
    }

    private static Object file() throws ReflectiveOperationException {
        Class<?> c = Class.forName("dev.ftb.mods.ftbquests.client.ClientQuestFile");
        if (!(Boolean) c.getMethod("exists").invoke(null)) return null;
        return c.getField("INSTANCE").get(null);
    }

    private static Object teamData(Object f) throws ReflectiveOperationException {
        return f.getClass().getField("selfTeamData").get(f);
    }

    private static String titleOf(Object qo) {
        try {
            Object t = qo.getClass().getMethod("getTitle").invoke(qo);
            Object s = t.getClass().getMethod("getString").invoke(t);
            return String.valueOf(s);
        } catch (Exception e) {
            return String.valueOf(qo);
        }
    }

    private static long idOf(Object qo) throws ReflectiveOperationException {
        try {
            return (Long) qo.getClass().getField("id").get(qo);
        } catch (NoSuchFieldException e) {
            return (Long) qo.getClass().getMethod("getId").invoke(qo);
        }
    }

    private static java.util.List<Object> allQuests(Object f)
            throws ReflectiveOperationException {
        java.util.List<Object> out = new java.util.ArrayList<>();
        java.util.function.Consumer<Object> collect = out::add;
        @SuppressWarnings("unchecked")
        java.util.function.Consumer<Object> cc = collect;
        f.getClass().getMethod("forAllQuests", java.util.function.Consumer.class)
            .invoke(f, cc);
        return out;
    }

    /** quest.list: 章名+クエスト名+進捗状態を一覧 */
    public static JsonObject list() throws ReflectiveOperationException {
        Object f = file();
        JsonObject r = new JsonObject();
        if (f == null) {
            r.addProperty("synced", false);
            r.add("quests", new JsonArray());
            return r;
        }
        Object td = teamData(f);
        JsonArray arr = new JsonArray();
        for (Object q : allQuests(f)) {
            JsonObject o = new JsonObject();
            long id = idOf(q);
            o.addProperty("id", id);
            o.addProperty("title", titleOf(q));
            Object ch = q.getClass().getMethod("getQuestChapter").invoke(q);
            if (ch != null) o.addProperty("chapter", titleOf(ch));
            addProgress(o, td, id);
            arr.add(o);
        }
        r.addProperty("synced", true);
        r.add("quests", arr);
        return r;
    }

    /** quest.inspect: タスク・報酬・依存を詳細取得 */
    public static JsonObject inspect(String name)
            throws ReflectiveOperationException {
        Object f = file();
        if (f == null) throw new IllegalStateException("quest data not synced");
        Object td = teamData(f);
        Object target = null;
        for (Object q : allQuests(f)) {
            if (titleOf(q).equalsIgnoreCase(name)
                || String.valueOf(idOf(q)).equals(name)) { target = q; break; }
        }
        if (target == null)
            throw new IllegalArgumentException("unknown quest: " + name);
        JsonObject o = new JsonObject();
        long id = idOf(target);
        o.addProperty("id", id);
        o.addProperty("title", titleOf(target));
        addProgress(o, td, id);

        JsonArray tasks = new JsonArray();
        for (Object t : (Iterable<?>) target.getClass()
            .getMethod("getTasks").invoke(target)) {
            JsonObject to = new JsonObject();
            to.addProperty("type", t.getClass().getSimpleName());
            to.addProperty("title", titleOf(t));
            try {
                to.addProperty("progress",
                    (Long) td.getClass().getMethod("getProgress",
                        Class.forName("dev.ftb.mods.ftbquests.quest.task.Task"))
                        .invoke(td, t));
            } catch (Exception ignore) {}
            tasks.add(to);
        }
        o.add("tasks", tasks);
        JsonArray rewards = new JsonArray();
        java.util.UUID selfUuid = net.minecraft.client.Minecraft
            .getInstance().player != null
                ? net.minecraft.client.Minecraft.getInstance()
                    .player.getUUID() : null;
        for (Object rw : (Iterable<?>) target.getClass()
            .getMethod("getRewards").invoke(target)) {
            JsonObject ro = new JsonObject();
            ro.addProperty("type", rw.getClass().getSimpleName());
            ro.addProperty("title", titleOf(rw));
            try {
                ro.addProperty("id", idOf(rw));
            } catch (Exception ignore) {}
            if (td != null && selfUuid != null) {
                try {
                    ro.addProperty("claimed", (Boolean) td.getClass()
                        .getMethod("isRewardClaimed", java.util.UUID.class,
                            Class.forName(
                                "dev.ftb.mods.ftbquests.quest.reward.Reward"))
                        .invoke(td, selfUuid, rw));
                } catch (Exception ignore) {}
            }
            rewards.add(ro);
        }
        o.add("rewards", rewards);
        return o;
    }

    /**
     * quest.claim: 報酬クレーム。rewardId指定→個別ClaimRewardMessage、
     * 未指定→ClaimAllRewardsMessageをarchitectury経由で送信。
     */
    public static JsonObject claim(Long rewardId)
            throws ReflectiveOperationException {
        Object msg;
        if (rewardId != null) {
            Class<?> c = Class.forName(
                "dev.ftb.mods.ftbquests.net.ClaimRewardMessage");
            msg = c.getConstructor(long.class, boolean.class)
                .newInstance(rewardId, true);
        } else {
            Class<?> c = Class.forName(
                "dev.ftb.mods.ftbquests.net.ClaimAllRewardsMessage");
            msg = c.getConstructor().newInstance();
        }
        Class<?> base = Class.forName(
            "dev.architectury.networking.simple.BaseC2SMessage");
        base.getMethod("sendToServer").invoke(msg);
        JsonObject r = new JsonObject();
        r.addProperty("sent", true);
        if (rewardId != null) r.addProperty("reward_id", rewardId);
        return r;
    }

    private static void addProgress(JsonObject o, Object td, long questId) {
        if (td == null) return;
        try {
            java.util.Optional<?> done = (java.util.Optional<?>)
                td.getClass().getMethod("getCompletedTime", long.class)
                    .invoke(td, questId);
            java.util.Optional<?> started = (java.util.Optional<?>)
                td.getClass().getMethod("getStartedTime", long.class)
                    .invoke(td, questId);
            o.addProperty("completed", done.isPresent());
            o.addProperty("started", started.isPresent());
        } catch (Exception ignore) {}
    }
}
