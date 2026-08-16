// 平台方法桥（P4b 骨架 / P5 原生能力接入）：
// 对应 Electron main.js 的 18 个平台方法。JS 可直接实现的（xlsx 读写/saveImage/GitHub 同步）
// 在 electron-mobile/platform-methods.js 完成，本插件只承载需要原生能力的 5 个：
//   getVersion     —— BuildConfig 版本号
//   openExternal   —— ACTION_VIEW 打开 http/https 外链
//   kbPickFiles    —— 系统文件选择器选 md/pdf（多选），返回 [{ name, ext, size, base64 }]
//   kbImportFiles  —— 同上（WebView 侧用字节走共享 importKbFiles 完成导入）
//   pickBackup     —— 选 .db 备份文件，返回 { name, base64 }（WebView 侧覆盖内存库）
package com.songerjia.tikumobile;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "TikuBridge")
public class TikuBridgePlugin extends Plugin {

    // ---- 版本号（build.gradle versionName）----
    @PluginMethod
    public void getVersion(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("name", "知识记忆小助手");
        ret.put("version", BuildConfig.VERSION_NAME);
        call.resolve(ret);
    }

    // ---- 外链（协议白名单：仅 http/https）----
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            call.reject("仅支持 http/https 链接");
            return;
        }
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            call.resolve();
        } catch (Exception e) {
            call.reject("打开链接失败：" + (e.getMessage() == null ? e.toString() : e.getMessage()));
        }
    }

    // ---- 知识文档选择（多选 md/pdf）----
    @PluginMethod
    public void kbPickFiles(PluginCall call) {
        launchPicker(call, true, new String[]{"text/markdown", "text/plain", "application/pdf"});
    }

    // 选择并导入（字节处理在 WebView 侧，与 kbPickFiles 同一原生路径）
    @PluginMethod
    public void kbImportFiles(PluginCall call) {
        launchPicker(call, true, new String[]{"text/markdown", "text/plain", "application/pdf"});
    }

    // ---- 备份文件选择（.db）----
    @PluginMethod
    public void pickBackup(PluginCall call) {
        launchPicker(call, false, new String[]{"application/octet-stream"});
    }

    private void launchPicker(PluginCall call, boolean multi, String[] mimeTypes) {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multi); // 文档多选，备份单选
        // 修复：Capacitor 8 的 startActivityForResult 第三参是「@ActivityCallback 回调方法名」
        // 而非 requestCode——此前传 int（"9101"）导致 launcher 匹配失败、选择结果永远回不来
        startActivityForResult(call, i, "onPickerResult");
    }

    @ActivityCallback
    private void onPickerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject cancel = new JSObject();
            cancel.put("files", new JSArray());
            cancel.put("canceled", true);
            call.resolve(cancel);
            return;
        }
        JSArray files = new JSArray();
        if (result.getData().getClipData() != null) {
            for (int i = 0; i < result.getData().getClipData().getItemCount(); i++) {
                Uri uri = result.getData().getClipData().getItemAt(i).getUri();
                JSObject info = readFileInfo(uri);
                if (info != null) files.put(info);
            }
        } else if (result.getData().getData() != null) {
            JSObject info = readFileInfo(result.getData().getData());
            if (info != null) files.put(info);
        }
        JSObject ret = new JSObject();
        ret.put("files", files);
        ret.put("canceled", false);
        call.resolve(ret);
    }

    // 读取 uri 内容：{ name, ext, size, base64 }（base64 供 WebView 解出字节；NO_WRAP 无换行）
    private JSObject readFileInfo(Uri uri) {
        try {
            ContentResolver cr = getContext().getContentResolver();
            String name = null;
            Cursor c = cr.query(uri, null, null, null, null);
            if (c != null) {
                try {
                    if (c.moveToFirst()) {
                        int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        if (idx >= 0) name = c.getString(idx);
                    }
                } finally { c.close(); }
            }
            if (name == null) name = "file";
            String ext = "";
            int dot = name.lastIndexOf('.');
            if (dot >= 0) ext = name.substring(dot + 1).toLowerCase();

            byte[] bytes = readAll(cr.openInputStream(uri));
            JSObject o = new JSObject();
            o.put("name", name);
            o.put("ext", ext);
            o.put("size", bytes.length);
            o.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
            return o;
        } catch (Exception e) {
            // P6：读取失败不静默跳过——返回带 readError 的条目，WebView 端可见具体错误
            JSObject o = new JSObject();
            o.put("name", "file");
            o.put("ext", "");
            o.put("size", 0);
            o.put("base64", "");
            o.put("readError", e.getMessage() == null ? e.toString() : e.getMessage());
            return o;
        }
    }

    private byte[] readAll(InputStream in) throws Exception {
        if (in == null) throw new Exception("无法打开文件流");
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toByteArray();
        } finally { in.close(); }
    }
}
