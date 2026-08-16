// 平台方法桥（P4b 骨架 / P5 逐个实现）：
// 对应 Electron main.js 的 18 个平台方法（对话框/文件系统/外链/加密/更新/同步等）。
// WebView 端 bridge.js 的 APK 分支把这类调用转发到本插件；
// 当前全部返回 unimplemented，P5 按方法逐个接 Capacitor 原生能力。
package com.songerjia.tikumobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "TikuBridge")
public class TikuBridgePlugin extends Plugin {

    private JSObject unimplemented(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("error", "平台方法尚未在 APK 端实现（P5 逐个接入）");
        call.resolve(ret);
        return ret;
    }

    @PluginMethod
    public void checkUpdate(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void saveImage(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void kbImportFiles(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void kbPickFiles(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void openPath(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void restoreBackup(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void getVersion(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void openExternal(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void kbExport(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void kbOpen(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void parseSheet(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void exportExcel(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void exportExcelTemplate(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void exportCardTemplate(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void ghGetConfig(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void ghSaveConfig(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void ghTest(PluginCall call) { unimplemented(call); }

    @PluginMethod
    public void ghSync(PluginCall call) { unimplemented(call); }
}
