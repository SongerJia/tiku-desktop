package com.songerjia.tikumobile;

import android.os.Build;
import android.os.Bundle;
import android.view.Window;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册平台方法桥（checkUpdate/saveImage/kbImportFiles 等 18 个，P5 逐个实现）
        registerPlugin(TikuBridgePlugin.class);
        super.onCreate(savedInstanceState);
        // P6 真机修复：内容区不延伸到状态栏/刘海下（部分设备 WebView 顶到状态栏被遮挡）。
        // Android 15（API 35+）强制 edge-to-edge 时该调用无效，改由 CSS env(safe-area-inset-top) 兜底。
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(true);
        } else {
            Window w = getWindow();
            int flags = w.getDecorView().getSystemUiVisibility();
            flags &= ~(android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            w.getDecorView().setSystemUiVisibility(flags);
        }
    }
}
