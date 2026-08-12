# Firstlight

一个以 Chrome Bookmarks 为唯一书签数据源、通过 GitHub Gist 跨设备传递快照的极简新标签页。

Firstlight 有两个运行端：

- Chrome 扩展：读取和展示 Chrome Bookmarks，负责 Gist 上传与恢复。
- Online：只读展示 Gist 快照，可部署到 GitHub Pages、Cloudflare Pages 或 Vercel。

产品规格见 [SPEC.md](./SPEC.md)。MVP 功能已经完成，当前代码按封版候选管理。

## 本地开发

```bash
npm install
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
npm run typecheck
npm test
npm run build
```

提交封版变更前必须保证类型检查、完整测试、扩展构建校验和 Online 构建全部通过。

## 数据与同步

- Chrome Bookmarks 是本地书签的唯一数据源。
- Notes、显示设置和完整书签栏共同进入 `firstlight.json`。
- 本地变化采用 10 秒尾端防抖上传；上传前读取一次远端并依据语义哈希与同步基线判断冲突。
- Notes 保存会保留尚未确认的本地输入并在临时存储失败后重试；选择远端快照时会先停止未完成的 Notes 写入，避免旧草稿覆盖恢复结果。
- Gist 绑定失效时扩展会重新发现最新快照；Online 每次连接都重新发现 GitHub `updated_at` 最新的 Firstlight Gist。
- Online 只读取 Gist，显示配置仅保存在 Online 所在浏览器本地。

## 版本管理

项目使用 Git 管理。`node_modules`、`dist`、覆盖率文件和本地日志不进入仓库；封版提交应包含源码、测试、规格、锁文件和构建脚本。
