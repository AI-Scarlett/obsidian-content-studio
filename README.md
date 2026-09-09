# Mogao Content Studio

English | [简体中文](README.zh-CN.md)

Format Obsidian notes for WeChat Official Accounts, Zhihu, Xiaohongshu and X. Choose one of six built-in templates, adjust typography and colors, or learn reusable styles from an article URL. The interface is currently in Simplified Chinese.

Desktop only. This branch: 0.1.14 preview build with browser assistant 0.3.7. Requires Obsidian 1.8.7 or later; earlier native validation used 1.13.7. Formatting preserves your source text and runs locally. No AI account, API key or automatic publishing is required.

## Features

| Destination | Output |
| --- | --- |
| WeChat | Native DOCX with embedded media, rich text, HTML, Markdown and optional link references |
| Zhihu | Rich text and Markdown with headings, quotations, lists, code and tables |
| Xiaohongshu | Rich-text long-form body, individually copyable original images and 1080 × 1440 PNG cards |
| X | Rich-text article drafts and threads limited to 280 weighted characters per post |

Six templates: Ink (墨白), Cinnabar (朱砂), Bamboo (青竹), Blueprint (蓝图), Cream Notes (奶油手记) and Black & Gold (黑金刊物). Save adjustments as a new template, or import/export template JSON.

Images are loaded automatically from Vault attachments and public HTTP(S) URLs when you open a note in the studio. Their positions and order are preserved. Rich copying and package export stop if any image is unresolved, with a specific source and retry action. Each note supports up to 40 distinct images, at most 8 MB per image, with three simultaneous downloads.

## Installation

1. Download `main.js`, `manifest.json` and `styles.css` from [Releases](https://github.com/AI-Scarlett/obsidian-content-studio/releases/latest).
2. Create `.obsidian/plugins/content-studio/` inside your Vault and place the three files in that folder.
3. Enable **Mogao Content Studio** in Settings → Community plugins.
4. Open a note and use the newspaper ribbon icon, the **排版当前笔记** command (format current note), or **用墨稿排版** in the note's context menu.

For updates, replace only `main.js`, `manifest.json` and `styles.css`; keep `data.json` to preserve settings and custom templates. The plugin does not update itself.

## Workflow

1. Select a note with **选择笔记**, read the active note with **读取当前笔记**, or paste Markdown in the studio.
2. Write in the full-size editor; switch to **预览** for preview or **对照** for a side-by-side view on wide panes. Templates and styling live in the **模板与样式** drawer.
3. Wait for the image counter. Use **重新载入图片** to retry failures.
4. For WeChat, Xiaohongshu long-form, Zhihu or X Articles, click **发布到平台** in Mogao. The companion browser extension receives the current draft and images, opens the destination, waits for login if necessary, then uses its platform adapter to synchronize the separate title, structured body and inline images. There is no per-article file selection or import step.
5. If the extension is missing, the browser opens installation onboarding with the bundled preview extension download. After installation, subsequent articles start directly from Mogao.
6. Review the platform draft and its save status, then publish manually. Full extension acceptance on real platforms remains pending. Title/body copying and file exports remain available as secondary tools. X Articles requires the corresponding account access; ordinary X threads retain copying.

Each export creates a new folder under `墨稿导出/` by default, configurable in plugin settings. Packages include `article.html`, `article.md`, `title.txt`, `caption.txt`, `template.json`, `manifest.json`, and numbered image files. Markdown references are rewritten to the image files. HTML embeds the image bytes. Xiaohongshu exports additional PNG cards; X exports separate thread text files.

Draft edits are held in the open studio until exported; export before closing or reloading. Export manifests include the source note's relative path, so treat them as part of your private writing material.

## Learn styles from a link

**链接学模板** reads a public article and up to three stylesheets, extracts constrained typography, colors, headings and quotation styles, and previews them against your draft. Save the result with a name. Template JSON retains provenance and extraction notes, without copying the reference article's body.

For a login page, verification challenge or failed download, use **粘贴 HTML** with article HTML you can access. This is static style extraction: scripts, remote fonts, animation and complex nested designs are not reproduced pixel for pixel. No language model is called.

## Images and destination compatibility

PNG, JPEG, GIF, WebP and AVIF attachments are supported, including Obsidian `![[image.png]]` embeds and Markdown image references. SVG, PDFs, audio/video and other plugins' dynamic blocks are not embedded as images.

Rich copying writes `text/html` plus `text/plain`, with native selection copying as a compatibility fallback. Clipboard HTML includes embedded image data, which platform editors can reject. An HTML image tag is different from a clipboard image file: the per-image and per-card buttons write `image/png` without competing text formats. GIF image copying is static; source images over 40 megapixels must be resized first. Copy controls are excluded from article HTML and cards.

Ordinary Xiaohongshu photo posts have separate image and caption areas; long-form articles have a body editor. Paste images into the appropriate surface. Browser synchronization sends this article and its media only after the user clicks publish in Mogao. Login and final publication remain user-controlled. Local clipboard validation does not imply the destination accepted the images. DOCX and numbered image exports remain available.

DOCX retains basic paragraph and inline formatting, lists, tables, links and embedded images. It simplifies template decorations and maps light text to readable ink on a white page. WebP/AVIF/GIF become PNG (GIF is static); oversized images are bounded to 2000 px on their longest edge. Platform exports include separate `title.txt` and `body.txt`. Content package `caption.txt` contains the body only.

Long paragraphs are paginated for Xiaohongshu cards. An oversized indivisible table or image reports an adjustment requirement. Destination limits on text, image count, and X long-form posting depend on the platform and account.

## Network and privacy disclosure

- Reading/selecting a note in the studio, editing in image URLs, retrying images, or completing a copy/export with unresolved images downloads the referenced remote images. The image host receives its URL path/query and normal request metadata. Local attachments stay local.
- Link-based template learning requests the supplied article URL and up to three stylesheets. Requests do not include browser cookies, platform credentials or the entire note body.
- When the system DNS returns a TUN proxy's `198.18.0.0/15` fake addresses, the downloader queries **Cloudflare DNS-over-HTTPS** (`cloudflare-dns.com`) for the target hostname only. It does not send the article body or URL query to that DNS service.
- The downloader validates public addresses and redirects and caps response size and time. It does not execute fetched scripts.
- No telemetry, model service, unsolicited synchronization, automatic updates or final publication. A user-started browser delivery polls only its newly opened destination until ready or cancelled.
- Vault enumeration occurs only when the user opens the note picker: it lists Markdown note paths for selection, without bulk-reading their bodies or transmitting the list. Opening the plugin or formatting the current note does not enumerate the Vault.
- Clipboard access is write-only, triggered by the copy buttons. The plugin never reads the clipboard, monitors it, or uploads clipboard contents.
- Settings and custom templates are stored in the plugin's `data.json`; exported drafts are stored in the Vault.

See [Data and network details](docs/privacy.md).

## Development

```sh
npm ci
npm run verify
npm run verify:extension
npm run package
```

`npm run verify` includes the official Obsidian ESLint recommended rules (zero warnings required), CSS lint, type checks, and 95 regression tests. `npm run verify:extension` adds 43 browser delivery tests, including real Tiptap/Draft.js models and offline WeChat contracts; these are not live platform acceptance. CSS is also checked against a conservative Chrome 120 compatibility profile. The development browser prototype was removed from the plugin source in 0.1.2; run the workbench inside Obsidian to test actual Vault behavior.

Releases are built from version tags by [GitHub Actions](https://github.com/AI-Scarlett/obsidian-content-studio/actions/workflows/release.yml). Only the three supported plugin files are attached to a Release; optional ZIP/checksum packages are available as Actions artifacts or via `npm run package`. The workflow generates GitHub build-provenance attestations for all three release files. After downloading them, verify provenance with:

```sh
gh attestation verify main.js --repo AI-Scarlett/obsidian-content-studio
gh attestation verify styles.css --repo AI-Scarlett/obsidian-content-studio
gh attestation verify manifest.json --repo AI-Scarlett/obsidian-content-studio
```

See [Review response](docs/review-response.md) for the source, CSS, release and behavior checks.

Source: `src/main.ts` (Obsidian host), `src/ui/studio.ts` (workbench), `src/core/` (rendering, images, templates and export). CI builds and tests the source. [Verification scope](docs/verification.md) · [Community submission guide](docs/submission.md) · [Report an issue](https://github.com/AI-Scarlett/obsidian-content-studio/issues).

## License

MIT © 2026 AI-Scarlett. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Browser publishing assistant (preview)

Start in Mogao with **发布到平台**. The extension automatically opens the selected platform, waits for login, and synchronizes the current article with inline image uploads and separate title. Missing extensions lead to installation onboarding with a bundled download. [Installation, permissions and validation limits](browser-extension/README.md). Full real-platform extension acceptance remains pending.

Click the browser assistant toolbar icon to open Obsidian and its Mogao workbench. Existing workbench edits are preserved; a newly opened workbench reads the active note. The first launch may require the browser’s external-app confirmation. The last-used vault must have Mogao enabled. On a pending publish handoff page, the icon continues that handoff instead.

The 0.1.14 preview bundles browser assistant 0.3.7, with platform-specific media and draft adapters. Existing unpacked extension installations must be reloaded once after updating their files. See [the release notes](docs/releases/0.1.14.md) and [browser assistant documentation](browser-extension/README.md) for current validation boundaries.


### 普通图文发布

在小红书或 X 平台下，直接点击底部 **发布长文** 或 **发布图文**。发布图文会打开对应的普通图文编辑器，按笔记顺序上传原图。无需导出文件、选择文件夹或逐张粘贴图片。平台最终发布仍由你操作。

- 小红书：自动填写独立标题和正文，文末 `#话题` 会预填到可编辑的话题栏，随后通过平台话题候选列表插入原生话题标签。至少 1 张、最多 18 张图片；标题不超过 20 字，正文含话题不超过 1,000 字。话题选择失败会明确提示，已上传图片保留。
- X：普通帖将标题放在首行，正文和话题在后，最多 4 张图片作为帖子附件。普通帖使用纯文本，图片不嵌在段落之间。墨稿不拦截 X 字数，也不截断或拆帖；由 X 判断当前账号的发布限制。
- 支持 PNG、JPEG、WebP。X 普通帖每张不超过 5 MB；小红书本工具每张不超过 8 MB。图片数量、格式或大小超限会停止发送；小红书仍检查标题和正文限制。
- 这两个入口已做模型与上传控件回归测试；本版真实账号多图上传尚未完成验收。见发布说明。
