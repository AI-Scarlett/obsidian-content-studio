# 提交到 Obsidian 插件目录

仓库：<https://github.com/AI-Scarlett/obsidian-content-studio>

Release：<https://github.com/AI-Scarlett/obsidian-content-studio/releases/tag/0.1.3>

| 字段 | 内容 |
| --- | --- |
| Plugin ID | `content-studio` |
| Name | `Mogao Content Studio` |
| Version / tag | `0.1.3`（不加 `v`） |
| Author | `AI-Scarlett` |
| Minimum Obsidian | `1.8.7` |
| Desktop only | `true` |
| License | MIT |

## 当前官方提交流程

1. 打开 <https://community.obsidian.md>，登录你的 Obsidian 账号。
2. 在 Profile → GitHub 连接 `AI-Scarlett`。
3. 进入 Plugins → New plugin，填入上方 GitHub 仓库 URL。
4. 选择归属账号，阅读并亲自同意开发者政策及维护责任，然后提交。
5. 查看自动检查与审核反馈。若要求修改，更新默认分支和版本，再创建同版本号的 Release。

这是官方当前的 Community 平台流程，不需要自行向 obsidian-releases 创建上架 PR。以提交页面的最新要求为准。

## 仓库与 Release 要求

- 仓库公开，根目录有 `README.md`、`LICENSE` 和 `manifest.json`；源码可读。
- 默认分支为 `main`；目录读取默认分支最新的 manifest。
- Release tag 与 manifest 的 version 完全一致。
- Release 仅附带 `main.js`、`manifest.json`、`styles.css`，由 GitHub Actions 构建，并有对应的来源证明。ZIP 与校验和仅保留为 Actions 构建产物，不附到 Release。
- README 披露自动图片下载、文章/CSS 请求及 Cloudflare DNS 后备查询。
- README 明确图片剪贴板能力和真实平台接收尚未验证的边界。

官方说明：<https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin>。

## 更新已提交的版本

0.1.3 修复源码和 CSS 检查，发布流程提供来源证明。请在现有插件条目中重新运行检查，确保读取到默认分支和 `0.1.3` Release。Vault Enumeration 和 Clipboard Access 是保留功能的行为说明，具体范围见 [审核说明](review-response.md)。
