package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.protocol.game.ServerboundSetCarriedItemPacket;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.item.ItemStack;

/**
 * AUTO_EAT反射の実行体。インベントリ内の最高回復量の食品を選び、
 * 必要ならhotbarへswapして実入力経路 (keyUse hold) で食事する。
 * 失敗時は AgentCapabilities に eat=false を学習する (Elly式)。
 */
public class EatTask extends AgentTask {
    private static final int MAX_TICKS = 120;

    private int t = 0;
    private boolean started = false;
    private boolean using = false;
    private int srcInv = -1;     // 食品があったinv index (9-35の場合swap対象)
    private int hotbar = -1;
    private boolean swapped = false;
    private String itemId = null;

    public EatTask(String id) { super(id); }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        if (state == State.CANCELLING) {
            release(mc, p);
            restore(mc, p);
            state = State.CANCELLED;
            return;
        }

        if (!started) {
            // D59/P2-9: 別メニュー (チェスト等) が開いている間は
            // containerId 0 前提のクリックが届かず、食品が手に渡らない
            // まま USE_FAILED → eat 能力が恒久喪失していた。メニューが
            // 開いているのは一過性なので、学習せず即失敗で返す
            if (p.containerMenu != p.inventoryMenu) {
                fail("MENU_OPEN", "a container menu is open; cannot eat now");
                return;
            }
            int slot = bestFood(p);
            if (slot < 0) {
                errorCode = "NO_FOOD";
                errorMessage = "no edible item in inventory";
                state = State.FAILED;
                return;
            }
            srcInv = slot;
            hotbar = p.getInventory().selected;
            // メインインベントリ (9-35) の食品は手持ちhotbarとswapする
            if (slot >= 9) {
                int srcMenu = slot;            // inv 9-35 → menu slot 9-35
                int dstMenu = 36 + hotbar;     // hotbar i → menu slot 36+i
                int cid = p.inventoryMenu.containerId;
                mc.gameMode.handleInventoryMouseClick(cid, srcMenu, 0,
                    ClickType.PICKUP, p);
                mc.gameMode.handleInventoryMouseClick(cid, dstMenu, 0,
                    ClickType.PICKUP, p);
                swapped = true;
            } else {
                p.getInventory().selected = slot;
                hotbar = slot;
            }
            if (p.connection != null)
                p.connection.send(new ServerboundSetCarriedItemPacket(hotbar));
            mc.options.keyUse.setDown(true);
            started = true;
            return;
        }

        t++;
        if (p.isUsingItem()) using = true;
        if (using && !p.isUsingItem()) {
            // 食べ終わった
            finish(mc, p);
            return;
        }
        if (!using && t > 8) {
            release(mc, p);
            restore(mc, p);
            // 使えないitemだった = 能力不存在として学習
            com.minecrafttogether.agent.game.AgentCapabilities.learn("eat", false);
            fail("USE_FAILED", "use did not start (not edible?)");
            return;
        }
        if (t > MAX_TICKS) {
            release(mc, p);
            restore(mc, p);
            fail("TIMEOUT", "eating did not complete in " + MAX_TICKS + " ticks");
        }
    }

    /** 最も回復量の高い食品のinv index (0-35)。無ければ-1 */
    private int bestFood(LocalPlayer p) {
        var inv = p.getInventory();
        int best = -1, bestNutrition = -1;
        for (int i = 0; i < 36; i++) {
            ItemStack s = inv.getItem(i);
            if (s.isEmpty()) continue;
            // entity-aware getFoodProperties でmodded食品も拾う
            FoodProperties fp = s.getItem().getFoodProperties(s, p);
            if (fp == null) continue;
            if (fp.getNutrition() > bestNutrition) {
                bestNutrition = fp.getNutrition();
                best = i;
            }
        }
        if (best >= 0) {
            var id = BuiltInRegistries.ITEM.getKey(inv.getItem(best).getItem());
            itemId = id != null ? id.toString() : "?";
        }
        return best;
    }

    private void release(Minecraft mc, LocalPlayer p) {
        mc.options.keyUse.setDown(false);
        if (p.isUsingItem()) mc.gameMode.releaseUsingItem(p);
    }

    /** swapした食品の残りを元slotへ戻す (best-effort) */
    private void restore(Minecraft mc, LocalPlayer p) {
        if (!swapped) return;
        int cid = p.inventoryMenu.containerId;
        mc.gameMode.handleInventoryMouseClick(cid, 36 + hotbar, 0,
            ClickType.PICKUP, p);
        mc.gameMode.handleInventoryMouseClick(cid, srcInv, 0,
            ClickType.PICKUP, p);
        swapped = false;
    }

    private void finish(Minecraft mc, LocalPlayer p) {
        release(mc, p);
        restore(mc, p);
        com.minecrafttogether.agent.game.AgentCapabilities.learn("eat", true);
        JsonObject r = new JsonObject();
        r.addProperty("item", itemId);
        r.addProperty("ticks", t);
        result = r;
        state = State.SUCCEEDED;
    }

    @Override
    protected void onPause() {
        Minecraft mc = Minecraft.getInstance();
        if (mc != null && mc.player != null) {
            release(mc, mc.player);
            restore(mc, mc.player);
        }
    }

    @Override
    protected void onResume() {
        started = false; // tick restarts the eat attempt cleanly
    }

    @Override
    public void cancel() { state = State.CANCELLING; }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }
}
