package com.minecrafttogether.agent.task;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.protocol.game.ServerboundPlaceRecipePacket;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.CraftingMenu;
import net.minecraft.world.inventory.RecipeBookMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.ShapedRecipe;

/**
 * レシピ帳packetによる自動クラフト (design Phase 1)。
 * 現在開いている RecipeBookMenu (InventoryMenu 2x2 または CraftingMenu 3x3)
 * に対して、place recipe → 結果スロット取り出しを count回繰り返す。
 *
 * 各反復はパケット往復を待つ必要があるためtick単位のタスクとして回す。
 * サーバーがレシピ帳未登録のレシピを弾くと grid が埋まらず失敗になる。
 */
public class CraftTask extends AgentTask {
    private final String itemName;
    private final int want;
    private CraftingRecipe recipe;
    private int produced = 0;
    private int phase = 0; // 0=解決 1=配置送信 2=取り出し 3=待機
    private int waitTicks = 0;
    private int totalTicks = 0;
    private static final int PLACE_WAIT = 20; // FastSuite等の非同期place対応で長めに
    private static final int TAKE_WAIT = 3;
    private static final int TOTAL_LIMIT = 20 * 60;

    public CraftTask(String id, String itemName, int want) {
        super(id);
        this.itemName = itemName;
        this.want = Math.max(1, want);
    }

    @Override
    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (p == null) { fail("NOT_IN_GAME", "player is not in a world"); return; }
        if (state == State.CANCELLING) { state = State.CANCELLED; return; }
        waitTicks++;
        if (++totalTicks > TOTAL_LIMIT) {
            fail("TIMEOUT", "craft took too long, produced " + produced + "/" + want);
            return;
        }

        AbstractContainerMenu menu = p.containerMenu;
        if (!(menu instanceof RecipeBookMenu)) {
            fail("BAD_STATE", "no crafting menu (need player inventory or crafting table)");
            return;
        }

        switch (phase) {
            case 0 -> {
                recipe = findRecipe(mc);
                if (recipe == null) {
                    fail("NO_RECIPE", "no crafting recipe for " + itemName);
                    return;
                }
                if (!fitsIn2x2(recipe) && !(menu instanceof CraftingMenu)) {
                    fail("NEED_TABLE", itemName + " requires a crafting table (3x3)");
                    return;
                }
                phase = 1;
            }
            case 1 -> {
                p.connection.send(new ServerboundPlaceRecipePacket(
                    menu.containerId, recipe, false));
                phase = 2;
                waitTicks = 0;
            }
            case 2 -> {
                ItemStack res = menu.getSlot(0).getItem();
                if (res.isEmpty()) {
                    if (waitTicks < PLACE_WAIT) return;
                    fail("RECIPE_REJECTED",
                        "grid not filled for " + recipe.getId()
                            + " (recipe not in recipe book or materials missing)");
                    return;
                }
                produced += res.getCount();
                mc.gameMode.handleInventoryMouseClick(
                    menu.containerId, 0, 0, ClickType.QUICK_MOVE, p);
                phase = 3;
                waitTicks = 0;
            }
            case 3 -> {
                if (waitTicks < TAKE_WAIT) return;
                if (produced >= want) {
                    succeed();
                    return;
                }
                phase = 1;
                waitTicks = 0;
            }
        }
    }

    private static boolean fitsIn2x2(CraftingRecipe rec) {
        if (rec instanceof ShapedRecipe sh) return sh.getWidth() <= 2 && sh.getHeight() <= 2;
        int n = 0;
        for (var ing : rec.getIngredients()) if (!ing.isEmpty()) n++;
        return n <= 4;
    }

    /**
     * 同一成果物のレシピが複数ある (modが代替レシピを足す) ので、
     * 全材料をインベントリで賄えるものを優先する。
     */
    private CraftingRecipe findRecipe(Minecraft mc) {
        ResourceLocation wantId = ResourceLocation.tryParse(itemName);
        LocalPlayer p = mc.player;
        if (wantId == null || p == null || mc.level == null || mc.getConnection() == null)
            return null;
        CraftingRecipe fallback = null;
        for (Recipe<?> rec : mc.getConnection().getRecipeManager().getRecipes()) {
            if (!(rec instanceof CraftingRecipe cr)) continue;
            ItemStack res = rec.getResultItem(mc.level.registryAccess());
            ResourceLocation id = BuiltInRegistries.ITEM.getKey(res.getItem());
            if (id == null || !id.equals(wantId)) continue;
            if (fallback == null) fallback = cr;
            if (satisfiable(cr, p)) return cr;
        }
        return fallback;
    }

    /** 全材料slotについて、選択肢のどれかがインベントリにあれば充足とみなす */
    private static boolean satisfiable(CraftingRecipe rec, LocalPlayer p) {
        java.util.Set<String> have = new java.util.HashSet<>();
        for (ItemStack s : p.getInventory().items) {
            ResourceLocation id = BuiltInRegistries.ITEM.getKey(s.getItem());
            if (id != null) have.add(id.toString());
        }
        for (var ing : rec.getIngredients()) {
            if (ing.isEmpty()) continue;
            boolean ok = false;
            for (ItemStack opt : ing.getItems()) {
                ResourceLocation id = BuiltInRegistries.ITEM.getKey(opt.getItem());
                if (id != null && have.contains(id.toString())) { ok = true; break; }
            }
            if (!ok) return false;
        }
        return true;
    }

    private void succeed() {
        JsonObject r = new JsonObject();
        r.addProperty("item", itemName);
        r.addProperty("crafted", produced);
        r.addProperty("wanted", want);
        result = r;
        state = State.SUCCEEDED;
    }

    @Override
    public void cancel() { state = State.CANCELLING; }

    private void fail(String code, String msg) {
        errorCode = code; errorMessage = msg; state = State.FAILED;
    }
}
