package com.songerjia.tikumobile;

import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册平台方法桥（checkUpdate/saveImage/kbImportFiles 等 18 个，P5 逐个实现）
        registerPlugin(TikuBridgePlugin.class);
        super.onCreate(savedInstanceState);
        // P6 真机修复：Android 15+（API 35）强制 edge-to-edge——内容延伸到状态栏/导航条后被遮挡，
        // 且 CSS env(safe-area-inset-top) 只覆盖「刘海安全区」不覆盖「状态栏」→ 此处手动给内容根视图
        // 加系统栏 inset padding，让 WebView 从状态栏下方、导航条上方开始（小米 15 / Android 16 实测）。
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().getDecorView().getRootView().setOnApplyWindowInsetsListener((v, insets) -> {
                int top = 0, bottom = 0;
                Insets t = insets.getInsets(WindowInsets.Type.statusBars());
                Insets b = insets.getInsets(WindowInsets.Type.navigationBars());
                top = t.top;
                bottom = b.bottom;
                v.setPadding(0, top, 0, bottom);
                return WindowInsets.CONSUMED;
            });
        }
    }
}
