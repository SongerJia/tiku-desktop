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
import androidx.core.content.FileProvider;

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

    // ---- 内存 fs 持久化（S2 建议项）：把整棵内存文件系统快照写入应用私有目录
    //   getFilesDir()/tiku/，容量无 WebView localStorage 5MB 上限，且跨进程重启保留。
    //   name 仅允许 [a-zA-Z0-9._-]，防止路径穿越。
    private java.io.File tikuDataFile(String name) {
        java.io.File dir = new java.io.File(getContext().getFilesDir(), "tiku");
        return new java.io.File(dir, sanitize(name));
    }

    private String sanitize(String n) {
        if (n == null || n.isEmpty()) return "memfs.snapshot.json";
        return n.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    @PluginMethod
    public void fsWrite(PluginCall call) {
        String name = call.getString("name", "memfs.snapshot.json");
        String data = call.getString("data", "");
        try {
            java.io.File f = tikuDataFile(name);
            java.io.File dir = f.getParentFile();
            if (dir != null && !dir.exists()) dir.mkdirs();
            java.io.FileOutputStream out = new java.io.FileOutputStream(f);
            try {
                out.write(Base64.decode(data, Base64.NO_WRAP));
            } finally { out.close(); }
            call.resolve();
        } catch (Exception e) {
            call.reject("fsWrite 失败：" + (e.getMessage() == null ? e.toString() : e.getMessage()));
        }
    }

    @PluginMethod
    public void fsRead(PluginCall call) {
        String name = call.getString("name", "memfs.snapshot.json");
        try {
            java.io.File f = tikuDataFile(name);
            if (!f.exists()) { call.resolve(new JSObject()); return; }
            java.io.FileInputStream in = new java.io.FileInputStream(f);
            byte[] bytes = readAll(in);
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("fsRead 失败：" + (e.getMessage() == null ? e.toString() : e.getMessage()));
        }
    }

    @PluginMethod
    public void fsDelete(PluginCall call) {
        String name = call.getString("name", "memfs.snapshot.json");
        try {
            java.io.File f = tikuDataFile(name);
            if (f.exists()) f.delete();
            call.resolve();
        } catch (Exception e) {
            call.reject("fsDelete 失败：" + (e.getMessage() == null ? e.toString() : e.getMessage()));
        }
    }

    // ---- APK 自动更新：调起系统安装器安装已下载的更新包 ----
    // path 为相对 getFilesDir() 的（已 sanitize 过的）相对路径，如 "tiku/update.apk"。
    // 通过 FileProvider 生成 content:// URI 授予临时读权限，避免 Android 7+ 的 file:// 暴露限制。
    @PluginMethod
    public void installApk(PluginCall call) {
        String rel = call.getString("path", "");
        if (rel == null || rel.isEmpty()) { call.reject("缺少安装包路径"); return; }
        // 路径校验：禁止绝对路径与 .. 穿越（与 fs 系列 sanitize 同级别防护，防指向私有目录其他文件）
        if (rel.startsWith("/") || rel.contains("..")) { call.reject("非法安装包路径"); return; }
        try {
            java.io.File f = new java.io.File(getContext().getFilesDir(), rel);
            if (!f.exists()) { call.reject("更新包不存在：" + rel); return; }
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                f
            );
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("安装失败：" + (e.getMessage() == null ? e.toString() : e.getMessage()));
        }
    }
}
