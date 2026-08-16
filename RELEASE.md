# 发布说明（Windows 安装包 + Android APK）

应用信息
- 应用名（APK 显示）：**知识题库**
- 包名：`com.songerjia.tikumobile`
- Windows 产品名：知识记忆小助手（见 `package.json` 的 `productName`）
- 图标：由 `build/icon.png` 生成全套 Android 启动图标（`android/app/src/main/res/mipmap-*`）。

---

## 一、在 GitHub Actions 自动发布（推荐）

1. 推送代码到 `main`（含本仓库的 `.github/workflows/release.yml`）。
2. 打开仓库 **Actions → Release (Windows + APK) → Run workflow**：
   - `version` 留空 → 自动读取 `package.json` 的 `version`（如 `0.7.0`）；
   - 也可手动填版本号。
3. 工作流会：构建 Windows NSIS 安装包 → 构建 Android APK（已配签名密钥则打 release 签名包，否则降级 debug）→ 在 GitHub 创建 `vX.Y.Z` Release 并上传两个产物。

> 版本号随 `package.json` 走。要升版本先跑 `npm run bump patch|minor|major`，再提交并触发发布。

---

## 二、配置 Android 签名密钥（打“正式 release 包”才需要）

未配置密钥时，工作流会自动产出 **debug APK**（功能完整、可直接安装，仅未签名）。
如需签名 release 包（更正式、可上架），按下面生成一次并存入仓库 Secrets：

```bash
# 1) 生成本地密钥库（请牢记 alias / 两个密码，丢失后无法更新已发布应用）
keytool -genkeypair -v -keystore release-keystore.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias tiku

# 2) base64 编码（单行）
base64 -w0 release-keystore.jks > release-keystore.jks.b64
cat release-keystore.jks.b64   # 复制全部内容
```

在仓库 **Settings → Secrets → Actions** 新增 4 个仓库密钥：
- `ANDROID_KEYSTORE_BASE64`：上面 `.b64` 文件的全部内容
- `ANDROID_KEY_ALIAS`：`tiku`
- `ANDROID_KEY_PASSWORD`：key 密码
- `ANDROID_STORE_PASSWORD`：keystore 密码

配置后再次触发工作流，CI 会解码密钥并打出**签名 release APK**。
`release-keystore.jks` 已被 `.gitignore` 忽略，不会入库；请本地妥善保管，切勿泄露。

---

## 三、本地手动打包

### Windows 安装包
```bash
npm run release        # = bump 后：vite build + electron-builder --publish always（需仓库 GH_TOKEN）
# 或仅本地产出（不上传）：
npm run dist
```
产物在 `release/`（如 `tiku-desktop-setup-0.7.0.exe`）。

### Android APK
```bash
npm run build:mobile
npx cap sync android
cd android
# 调试包（免签名，直接安装）：
gradlew assembleDebug
# 或签名 release 包（需本地 release-keystore.jks + 环境变量 ANDROID_KEY_ALIAS/PASSWORD）：
gradlew assembleRelease
```
APK 位于 `android/app/build/outputs/apk/{debug,release}/`。

---

## 四、注意事项
- APK 版本号由 `package.json` 推导：`versionCode = MAJOR*10000 + MINOR*100 + PATCH`（如 0.7.0 → 700），升级时必须递增。
- 签名密钥一旦生成请永久保存；换密钥后旧用户无法增量更新（需卸载重装）。
- 自定义图标只需替换 `build/icon.png`（建议 512×512 透明背景），重新跑本仓库的图标生成脚本即可刷新 `mipmap-*`。
