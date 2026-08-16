package com.songerjia.tikumobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册平台方法桥（checkUpdate/saveImage/kbImportFiles 等 18 个，P5 逐个实现）
        registerPlugin(TikuBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
