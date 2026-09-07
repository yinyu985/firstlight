# Chrome Web Store 发布资料

单一用途：替换 Chrome 新标签页，展示和搜索书签栏，提供 Notes，并通过用户自己的 GitHub Gist 同步完整快照。

## 权限理由

| 权限                       | 用途                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| bookmarks                  | 读取书签栏、监听修改，以及用户明确选择远端时恢复书签栏                  |
| storage                    | 保存设置、Notes、同步元数据和凭证保存偏好；会话凭证使用 storage.session |
| unlimitedStorage           | 完整快照最多 10 MiB，恢复点及待处理对比可能超过 Chrome 的默认存储限额   |
| alarms                     | Service Worker 暂停后继续执行防抖上传和有界重试                         |
| api.github.com             | 用户授权后的 Secret Gist 发现、读取、创建、更新                         |
| gist.githubusercontent.com | 下载 API 返回 truncated 的完整快照                                      |

不需要 browsing history、tabs、activeTab、webRequest 或任意网站内容脚本权限。

## Privacy tab 披露依据

选择认证信息（GitHub Token）、个人通信/用户生成内容（Notes 按表单的当前类别填写），并披露书签标题、URL 和文件夹结构。不收集浏览历史，但书签 URL 仍属于用户数据，不能填写“完全不处理用户数据”。数据仅用于上述单一用途，不用于出售、广告、信用判断、模型训练或无关转移。

隐私政策文件是 `public/privacy.html`，构建后位于 `dist/online/privacy.html`。提交商店前将它部署为可公开访问的 HTTPS 页面，并在商店填写实际 URL；填写维护者确认过的支持渠道，确认与隐私政策一致。不要擅自把 Git 提交邮箱当作公开支持邮箱。

Limited Use 声明已包含在隐私政策中。审核说明应解释：Token 由用户自己生成，默认只会话保存，用户选择记住才持久保存；数据直接发往用户的 GitHub Gist，Firstlight 不设同步服务器。

商店后台填写、截图、签名发布和公开部署属于实际发布流程，本地代码修复不会替代这些操作。
