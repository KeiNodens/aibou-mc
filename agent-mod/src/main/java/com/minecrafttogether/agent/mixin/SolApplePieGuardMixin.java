package com.minecrafttogether.agent.mixin;

import com.tarinoita.solsweetpotato.api.SOLSweetPotatoAPI;
import com.tarinoita.solsweetpotato.communication.FoodListMessage;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraftforge.network.NetworkEvent;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.function.Supplier;

/**
 * solapplepieの食事同期パケット(FoodListMessage)が、capability未装着や
 * 死亡/リスポーン直後の空窗期にクライアント側で FoodListNotFoundException
 * を投げて切断する問題へのガード。
 * ハンドラ冒頭でcapabilityの有無を確認し、無ければhandled=trueにして
 * 丸ごとスキップする (同期だけ飛ばすので実害なし、次の同期で追いつく)。
 */
@Mixin(targets = "com.tarinoita.solsweetpotato.communication.FoodListMessage$Handler",
       remap = false)
public class SolApplePieGuardMixin {

    @Inject(method = "handle", at = @At("HEAD"), cancellable = true)
    private static void aibou$guardMissingFoodCap(
            FoodListMessage msg,
            Supplier<NetworkEvent.Context> ctx,
            CallbackInfo ci) {
        LocalPlayer p = Minecraft.getInstance().player;
        boolean usable = false;
        if (p != null) {
            try {
                // capabilityが取れなければここで例外になるのを先回りして検査
                usable = p.getCapability(SOLSweetPotatoAPI.foodCapability).isPresent();
            } catch (Throwable ignored) {
                usable = false;
            }
        }
        if (!usable) {
            try {
                ctx.get().setPacketHandled(true);
            } catch (Throwable ignored) {
            }
            ci.cancel();
        }
    }
}
