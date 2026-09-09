# 图文同步：GitHub 源码核对与接入决策

核对日期：2026-09-08。此文记录源码研究与失败草稿的只读检查，**不代表修复已完成或新版本已安装**。

## 结论

保留墨稿的写作、排版和 Obsidian → 浏览器任务传递层；替换把多个平台都当作普通 `contenteditable` 的通用图片粘贴流程。平台接入需要分别处理图片上传、编辑器文档状态和草稿地址。

用户操作保持：墨稿点击发布 → 浏览器助手接收当前稿件和图片字节 → 打开目标平台，必要时等待用户登录 → 自动填入标题、正文和原位置图片 → 用户检查草稿并自行最终发表。不能要求每篇文章导出文件、选择文件夹、逐张手动补图，也不能用小红书图文笔记替代小红书长文。

本次没有找到一个已核对源码、可直接覆盖这四个平台长文需求的项目。以下是分平台候选；源码中存在实现不等于已经在本机账号验收通过。

## 参考项目与可复用范围

| 项目 | 固定版本 | 源码证明的能力 | 接入决定与限制 |
| --- | --- | --- | --- |
| [leaperone/MultiPost-Extension](https://github.com/leaperone/MultiPost-Extension) | `fdbc6c3b2f3c03f57be8a59b46e33860689ba509`，2026-09-01，v1.4.7 | 公众号上传素材、替换正文图片 URL、创建草稿、根据返回的草稿 ID 打开编辑页 | 公众号首选参考。Apache-2.0；复用代码需随分发保留许可证及适用声明。其知乎仍依赖 HTML 粘贴；小红书实现是普通图文笔记，不能据此宣称长文可用。 |
| [wechatsync/Wechatsync](https://github.com/wechatsync/Wechatsync) | `a98e42865387285afcc027c61836488748f3b30f`，2026-05-27 | 知乎二进制图片上传、图片就绪检查、创建及更新文章草稿、返回草稿地址 | 知乎上传和草稿协议参考。GPL-3.0；不能把代码直接拷入后继续全部标为 MIT。若实际复用，需按 GPL 处理相应分发；接口事实研究与代码复制应区分。 |
| [nevertoday/xposter](https://github.com/nevertoday/xposter) | `ac93d21dfe8482496441034e3e35d46aceefcbba`，2026-06-13，v1.42.70 | X Articles 的 Draft.js 文档写入、调用真实媒体上传处理函数、按位置安放媒体、检查媒体实体状态 | X 长文首选参考，MIT。需保留版权和许可证；仍要验证账号是否具有 Articles 编辑入口以及当前网页兼容性。 |
| [Ubanillx/rednote-skills](https://github.com/Ubanillx/rednote-skills) | `48f4ad4a4eac5812542cec4e93244c864aa896f4`，2026-04-08 | 小红书“写长文→新的创作”，通过工具栏“图片”触发平台上传，按文本/图片顺序插入 | 小红书长文操作路径参考。未找到许可证，不复制源码。它是浏览器自动化脚本，并非可直接嵌入墨稿的扩展适配器；其图片计数检查也不足以证明保存后的完整性。 |
| [DavidLam-oss/obsidian-wechat-converter](https://github.com/DavidLam-oss/obsidian-wechat-converter) | `f2e7ac08eecf5f4dbf9d3c987a48b79ffbb2316c`，2026-09-06 | Obsidian 本地图片打包、本机桥接、任务回传；微信官方图片和草稿 API | 桥接和资产结构参考，MIT。其微信链路需要 AppID/AppSecret，不符合当前用户仅使用浏览器现有登录的要求；其他平台的配套助手不可仅依据 README 宣称已验证。 |

### 公众号：先取得草稿 ID，再打开编辑器

MultiPost 的关键文件：[weixin.ts](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/article/weixin.ts)。

- `uploadImage`（162–210 行）：把图片作为二进制表单上传至 `/cgi-bin/filetransfer`，取得素材 ID 与 CDN URL。
- `uploadImageBySource`（213 行起）：远程图片可尝试 `/cgi-bin/uploadimg2cdn`。Obsidian 本地图片应走字节上传，不能向平台传 vault 路径。
- `processContent`（449 行起）：遍历正文图片并替换成平台返回的图片地址。
- `createArticle`（278–446 行）：通过 `/cgi-bin/operate_appmsg` 创建草稿并取得 `appMsgId`。
- 主流程（531 行起）：处理正文、封面、草稿，随后构造包含实际草稿 ID 的编辑地址。

这比等待首页中某个恰好是 `<a>` 的“图文”按钮更可靠。接入时只采用草稿能力；不能照搬上游的账号/正文调试日志，也不能把保存草稿描述为已经发表。封面选取及裁剪必须结合墨稿自身稿件模型处理，不能照搬源码中的固定裁剪参数。

这些是登录后的网页接口，不是承诺长期稳定的官方开放 API。需要验证失败响应、登录过期、重复点击的幂等性及草稿回读。

### 知乎：图片上传与草稿写入分开核对

Wechatsync 的关键文件：[zhihu.ts](https://github.com/wechatsync/Wechatsync/blob/a98e42865387285afcc027c61836488748f3b30f/packages/core/src/adapters/platforms/zhihu.ts)。

- 创建草稿（94–133 行）：`POST /api/articles/drafts`，保留返回 ID。
- 图片替换及更新（140–179 行）：上传并替换图片 URL，`PATCH /api/articles/{id}/draft` 更新标题和正文，返回 `/p/{id}/edit`。
- 本地图片（288–295、323–377 行）：将 data URI 转为字节，计算图片 hash，向 `api.zhihu.com/images` 请求上传信息，上传至知乎图片存储。
- 就绪检查（383 行起）：查询图片处理状态；请求成功或出现一个图片节点不能单独作为成功依据。

MultiPost 的 [知乎实现](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/article/zhihu.ts) 仍通过 `ClipboardEvent` 送入 HTML，不能作为本次图片失败的完整替代方案。

### 小红书：核对的是长文工具栏上传

关键文件：[publish_note.py](https://github.com/Ubanillx/rednote-skills/blob/48f4ad4a4eac5812542cec4e93244c864aa896f4/scripts/publish_note.py)。

- `ensure_long_form_editor`（139 行起）处理写长文与新的创作入口。
- `find_toolbar_button_by_tooltip`（103 行起）通过 `button.menu-item` 的“图片”提示定位上传按钮。
- `insert_body_tokens`（232 行起）按内容顺序写入文本，触发图片工具栏，再由自动化把已准备好的图片交给平台文件选择器。

这里的文件选择由程序自动完成，不要求用户去文件夹找笔记或图片。不过，它依赖 Playwright 的文件选择器 API；浏览器扩展不能直接照搬。扩展实现仍需确认平台真实上传处理入口和插入位置机制，不能假设页面一直存在可填充的 `input[type=file]`。

该项目只等待图片数量增加，对重复图片、错位、未完成上传和草稿重开后的状态缺少充分验证。本轮没有执行其脚本。

### X：应接入 Articles 的文档和媒体模型

关键文件：[main-world.js](https://github.com/nevertoday/xposter/blob/ac93d21dfe8482496441034e3e35d46aceefcbba/src/main-world.js)，[工作流程说明](https://github.com/nevertoday/xposter/blob/ac93d21dfe8482496441034e3e35d46aceefcbba/README.zh-CN.md)。

- `findDraftStateNode`（88 行起）找到真实 Draft.js 编辑器。
- `uploadFilesToEditor`（418 行起）调用 X 的 `onFilesAdded`，传入图片文件字节。
- `uploadImageAtMarker`（707 行起）通过编辑器状态定位、上传并观察媒体实体。
- 后续位置整理使媒体回到文章对应位置；不以直接修改显示 DOM 替代文档状态更新。

普通帖子、线程和 Articles 应明确区分。模板中的任意 CSS 并不能在 X 中原样保留；目标是保留 Articles 支持的标题、段落、强调、列表、链接及正文图片。没有 Articles 权限时应说明原因，不能静默变成无格式普通帖子，也不能仅增加一个没有接入后端的按钮。

## 已排除的近似项目

- [Jackywxsz/Jacky-mdflow](https://github.com/Jackywxsz/Jacky-mdflow/tree/09712dd6eb83e4f392c7d9d95373dbc618a188cd)：AGPL-3.0。公众号侧有内嵌图片 HTML 复制，X 路线包含图片占位与打包，小红书是图片卡片；不满足四平台长文自动同步。不把它称作 Shanhai Media Pipeline。
- [rul845074-svg/codex-xhs-publisher](https://github.com/rul845074-svg/codex-xhs-publisher/tree/570315c20852ca170a4e685eb0f052b3ea92192c)：Apache-2.0。`post_article` 实际转向普通图文笔记上传，不是本次所需的小红书长文插图。
- Wechatsync README 的小红书支持描述：本次固定提交的适配器目录及注册表中未找到对应长文适配器，不能把介绍当实现证据。
- MultiPost 的 X Articles：实现及说明仍具有实验性质，优先选择源码更完整的 xPoster 作为研究对象。

## 墨稿当前失败与源码的对应关系

基线：源码提交 `10e9bd785fd413febef7911749285f9b74754e00`；Obsidian 预览版 0.1.6、浏览器扩展文件版本 0.2.1。这里没有据文件版本推断扩展正在运行的版本。

| 平台 | 本轮证据 | 能得出的结论 |
| --- | --- | --- |
| 知乎 | 只读检查失败草稿：真实 Draft.js 编辑器内已有 1 张加载完成的 750×1624 图片，域名是 `pic-private.zhihu.com`；另有两个未替换图片标记，标题为空 | `browser-extension/src/editor.ts` 的知乎 CDN 列表只有 `zhimg.com`，会拒绝这张实际已显示的平台图片。`finish()` 最后才填标题，因第一张图核验中断而无法到达。这是已定位缺陷；仅补域名尚不能证明其余上传/位置流程正确。 |
| 小红书 | 只读检查失败草稿：Tiptap 编辑器中有 2 张已加载的 750×1624 平台图，来自 `ros-preview.xhscdn.com`，位于第一处图片标记附近；3 个标记仍在，第一处缺最后一个 `D`；标题为空。检查时 DOM 中没有文件输入框 | 通用 DOM Range + 文件粘贴 + `execCommand("delete")` 的位置处理不能可靠地驱动该平台。两张图片的 URL 不同，不能据此断言二者一定是同一张；未核对图片身份。 |
| 公众号 | 用户报告停留首页；源码仅查找少数精确文本的 `<a href>` 新文章入口 | 入口条件过窄，当前流程不能保证进入编辑器。尚未证明当前首页控件的确切 DOM 类型；需要采用有实际草稿 ID 的入口或经过实测的原生新建动作。 |
| X | `src/ui/studio.ts` 明确隐藏 X 发布按钮，并对浏览器发布抛出不支持；扩展平台类型不含 X | 属于未实现，不能说是安装缓存或单纯按钮样式问题。 |

现有 Tiptap 测试使用真实文档事务，但图片上传处理器是测试替身。它们不能覆盖知乎实际 CDN、平台上传权限、小红书文件选择处理、真实浏览器选区差异，也不能证明刷新后的草稿持久化。

检查过程中没有改动或清理用户现有失败草稿。此文不包含账号令牌、完整正文、私有草稿地址或图片私有 URL。

## 替换顺序与验收条件

1. 平台适配器拆分：共享稿件与图片字节、取消、进度和草稿身份；平台分别实现准备、上传、写草稿、打开和验证。正文图片按位置 ID 管理，重复引用同一图片也不能混淆位置。
2. 公众号：以 MultiPost 素材/草稿链路为主要复用候选。保留上游许可证并去除无关账户日志、固定裁剪和最终发布行为。
3. 知乎：先修正实际平台图片地址判定；以图片上传及草稿协议为替换方向。GPL 源码不直接纳入仍声称全 MIT 的分发包。
4. 小红书：先通过真实长文工具栏验证图片上传和位置，再接到扩展；不继续围绕损坏标记反复追加模拟粘贴。
5. X：接入 xPoster 的 Articles 文档/媒体处理思路和可许可复用部分，再启用墨稿按钮；先验证真实账户的 Articles 能力。

每个平台使用新建的、明确标注“测试，请勿发布”的草稿验收，不覆盖已有内容。基础样例至少包含 3 张视觉不同的本地图片，分别处于开头、中间、末尾；再检查中文空格路径、重复图片引用以及上传失败。

验收必须从 Obsidian 的发布按钮开始：无文件选择步骤；标题准确且单独填写；图片身份、顺序、相邻正文和图注准确；无图片位置标记残留；平台已保存；重新打开草稿后仍完整。再检查未登录后继续、取消、重复点击以及失败后不重复创建草稿。最终发表始终留给用户。

**研究阶段状态（修复前）：**当时只完成源码研究与失败定位。后续 0.1.7 / 浏览器 0.3.0 的改动见 [版本说明](releases/0.1.7.md)：公众号采用素材/草稿协议；知乎保留原生上传入口并采用 Draft.js 文档模型，未复制 GPL 代码；小红书使用原生工具栏和 Tiptap；X 使用 xPoster 的可许可改编部分。实际平台验收与本地检查分别记录。

**当前实测限制：**本会话中，工具 URL 策略已拒绝访问公众号编辑页、扩展管理页及扩展内部进度页；不通过其他浏览器表面、外部脚本或接口绕过拒绝。小红书、知乎失败草稿的上述只读检查已完成。此限制不妨碍继续本地源码研究，但不能把本地代码测试算作这些被拒绝页面的实测通过。


## 2026-09-09 小红书图片块核对

当前页面加载的公开编辑器资源 `project-publish-vue.2de4b786.js` 显示：长文图片节点是 `image` 类型的块级原子节点，属性为 `imgs` 数组，每个条目保留图片地址、尺寸、图注和上传进度。原生上传完成后将对应条目的地址替换为平台预览地址，并把进度设为 100。这个结构与标准 Tiptap Image 扩展的顶层 `src` 不同。

墨稿 0.3.0 的位置核对只读顶层 `src`，因此无法识别已上传的第一张图片。0.3.1 改为识别专用数组，再通过图片 DOM 对应到唯一文档块，并完整保留该块。新测试在修复前复现同样的报错，修复后通过三图、重复地址及文档 JSON 重开。没有复制平台资源源码；仅按所观察到的接口结构实现适配与测试。

本轮尝试用合成图片在新测试稿触发原生工具栏上传，但浏览器自动化扩展缺少本地文件访问权限，`fileChooser.setFiles` 被拒绝。因此仍需区分这个已复现并修复的结构缺陷与完整浏览器发布流程的实测验收。
