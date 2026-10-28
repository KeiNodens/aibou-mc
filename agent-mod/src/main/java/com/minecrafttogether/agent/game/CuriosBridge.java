package com.minecrafttogether.agent.game;

import net.minecraft.world.item.ItemStack;
import net.minecraftforge.fml.ModList;

/**
 * Curios連携 (soft-dep, 全リフレクション)。
 * CPacketOpenCuriosを送ってCuriosメニューを開かせ、以降は通常の
 * container.read/click経路でcuriosスロットを操作する。
 */
public final class CuriosBridge {
    private static Boolean available;

    private CuriosBridge() {}

    public static synchronized boolean isAvailable() {
        if (available == null) {
            available = ModList.get().isLoaded("curios");
        }
        return available;
    }

    /**
     * サーバーにCuriosメニューのオープンを要求する。
     * メニューは非同期で開くので、呼び出し側は数tick待ってからcontainer.readする。
     */
    public static void requestOpen() throws ReflectiveOperationException {
        Class<?> nh = Class.forName(
            "top.theillusivec4.curios.common.network.NetworkHandler");
        Object channel = nh.getField("INSTANCE").get(null);
        Class<?> pkt = Class.forName(
            "top.theillusivec4.curios.common.network.client.CPacketOpenCurios");
        // carriedはサーバー側では未使用に近い扱い。EMPTYで送る
        Object msg = pkt.getDeclaredConstructor(ItemStack.class)
            .newInstance(ItemStack.EMPTY);
        channel.getClass().getMethod("sendToServer", Object.class)
            .invoke(channel, msg);
    }
}
