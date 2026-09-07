# Firstlight

一个以 Chrome Bookmarks 为唯一书签数据源、通过 GitHub Gist 跨设备传递快照的极简新标签页。

Firstlight 有两个运行端：

- Chrome 扩展：读取和展示 Chrome Bookmarks，负责 Gist 上传与恢复。
- Online：只读展示 Gist 快照，可部署到 GitHub Pages、Cloudflare Pages 或 Vercel。

产品规格见 [SPEC.md](./SPEC.md)。用户操作与 Token 权限见 [使用帮助](./public/help.html)，数据处理说明见 [隐私政策](./public/privacy.html)。发布前以质量门禁实际结果为准。

## 本地开发

```bash
npm ci
npm run test:e2e:install
npm run dev
npm run dev:online
```

- `npm run dev`：启动 Chrome 扩展页面的开发构建。
- `npm run dev:online`：启动 Online 只读版。

## 构建

```bash
npm run build
```

构建完成后：

- Chrome 扩展位于 `dist/extension`，可在 `chrome://extensions` 开启开发者模式后“加载已解压的扩展程序”。
- Online 只读版位于 `dist/online`。

## 测试

```bash
npm run check
```

使用 Node 22、npm 10。`npm run check` 与 CI 使用相同的零警告 ESLint、全仓格式检查、类型检查、单元/集成覆盖率、真实 Chromium E2E、双目标构建和生产依赖审计。Linux 首次运行使用 `npx playwright install --with-deps chromium`。

`npm run test:e2e` 使用独立临时浏览器配置及假 GitHub 响应，不读取用户的浏览器配置、Token 或书签。大列表、同步边界与 CSP 都有回归测试。

## 数据与同步

- Chrome Bookmarks 是本地书签的唯一数据源。
- Notes、显示设置和完整书签栏共同进入 `firstlight.json`。仅 Notes 正文使用原生 gzip + HKDF-SHA-256 / AES-256-GCM；标题、ID、时间在 `notes.items` 中可直接检查，书签和设置保持明文。跨设备及 Online 使用完全相同的 Gist token，无第二个密码，不兼容历史远端格式。
- 换 token 请在仍保存旧 token 的扩展中直接保存新值；远端正文重加密和回读成功后才切换。失败时暂停同步，再次保存同一个新 token 继续。此方案不保护本地原文、旧明文历史或泄露的 token，也不向 GitHub 保密。
- 本地变化采用 10 秒尾端防抖上传；上传前读取一次远端并依据语义哈希与同步基线判断冲突。
- Notes 保存会保留尚未确认的本地输入并在临时存储失败后重试；选择远端快照时会先停止未完成的 Notes 写入，避免旧草稿覆盖恢复结果。
- Gist 绑定失效时扩展会重新发现最新快照；Online 每次连接都重新发现 GitHub `updated_at` 最新的 Firstlight Gist。
- Online 只读取 Gist，显示配置仅保存在 Online 所在浏览器本地。

## 版本管理

项目使用 Git 管理。`node_modules`、`dist`、覆盖率文件和本地日志不进入仓库；封版提交应包含源码、测试、规格、锁文件和构建脚本。

`npm run package:release` 在完整检查后生成带版本、Git 提交和 SHA-256 的两个 ZIP。工作区未提交时名称带 `working`，不得当作正式标签发布。维护者确认变更后更新版本和 CHANGELOG，提交并创建对应 `vX.Y.Z` 标签。工具不会自动提交、打标签或公开发布。

## Online 部署

- Cloudflare Pages：构建命令 `npm run build:online`，输出目录 `dist/online`；构建包含 `_headers`。
- Vercel：仓库根目录 `vercel.json` 包含构建和安全头配置。
- GitHub Pages：发布 `dist/online`。Pages 无法自定义完整响应头；应用本身拒绝嵌入 iframe。需要完整的响应头策略时选择前两个平台或配置反向代理。

仅通过 HTTPS 发布；托管平台负责 TLS/HSTS。Data Viewer 的沙箱启动页具有单独的 CSP，不要用全站 `script-src 'self'` 覆盖它，否则用户的 data: 页面脚本会再次被阻断。测试预览服务器使用与产物相同的响应头。

## 维护

Dependabot 按周创建依赖更新 PR，CodeMirror、React、测试和构建工具分组；主版本升级单独审查，不以“全部升级到最新”替代兼容性验证。扩展最低 Chrome 120，与两个构建目标一致。

商店发布准备见 [store-listing.md](./docs/store-listing.md)。本地隐私政策需要部署为公开 HTTPS 页面后才能填写商店 URL。
