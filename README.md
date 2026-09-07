# Mogao Content Studio

English | [简体中文](README.zh-CN.md)

Format Obsidian notes for WeChat Official Accounts, Zhihu, Xiaohongshu and X. Choose one of six built-in templates, adjust typography and colors, or learn reusable styles from an article URL. The interface is currently in Simplified Chinese.

Desktop only. Version 0.1.1. Requires Obsidian 1.8.7 or later; native validation was performed on 1.13.7. Formatting preserves your source text and runs locally. No AI account, API key or automatic publishing is required.

## Features

| Destination | Output |
| --- | --- |
| WeChat | Inline-styled rich text, embedded images, HTML, Markdown and optional link references |
| Zhihu | Rich text and Markdown with headings, quotations, lists, code and tables |
| Xiaohongshu | Full captions and content-paginated 1080 × 1440 PNG cards |
| X | Rich-text article drafts and threads limited to 280 weighted characters per post |

Six templates: Ink (墨白), Cinnabar (朱砂), Bamboo (青竹), Blueprint (蓝图), Cream Notes (奶油手记) and Black & Gold (黑金刊物). Save adjustments as a new template, or import/export template JSON.

Images are loaded automatically from Vault attachments and public HTTP(S) URLs when you open a note in the studio. Their positions and order are preserved. Rich copying and package export stop if any image is unresolved, with a specific source and retry action. Each note supports up to 40 distinct images, at most 8 MB per image, with three simultaneous downloads.

## Installation

1. Download `content-studio-0.1.1.zip` from [Releases](https://github.com/AI-Scarlett/obsidian-content-studio/releases/latest).
2. Extract the `content-studio` folder into your Vault's `.obsidian/plugins/` directory. Alternatively, place the release's `main.js`, `manifest.json` and `styles.css` there.
3. Enable **Mogao Content Studio** in Settings → Community plugins.
4. Open a note and use the newspaper ribbon icon, the **排版当前笔记** command (format current note), or **用墨稿排版** in the note's context menu.

For updates, replace only `main.js`, `manifest.json` and `styles.css`; keep `data.json` to preserve settings and custom templates. The plugin does not update itself.

## Workflow

1. Select a note with **选择笔记**, read the active note with **读取当前笔记**, or paste Markdown in the studio.
2. Choose a platform and template. Adjust the title, text, font size or color. Studio edits do not overwrite the source note.
3. Wait for the image counter. Use **重新载入图片** to retry failures.
4. Use **复制标题** to copy the title only, and **复制正文** to copy the body without the generated article title. Body copying preserves images and formatting. Use **保存内容包** to export the complete article, including its title. Xiaohongshu caption and X thread copying contain text only; export the package for their images.
5. Paste or upload in the destination editor, verify its result, and publish manually.

Each export creates a new folder under `墨稿导出/` by default, configurable in plugin settings. Packages include `article.html`, `article.md`, `caption.txt`, `template.json`, `manifest.json`, and numbered image files. Markdown references are rewritten to the image files. HTML embeds the image bytes. Xiaohongshu exports additional PNG cards; X exports separate thread text files.

Draft edits are held in the open studio until exported; export before closing or reloading. Export manifests include the source note's relative path, so treat them as part of your private writing material.

## Learn styles from a link

**链接学模板** reads a public article and up to three stylesheets, extracts constrained typography, colors, headings and quotation styles, and previews them against your draft. Save the result with a name. Template JSON retains provenance and extraction notes, without copying the reference article's body.

For a login page, verification challenge or failed download, use **粘贴 HTML** with article HTML you can access. This is static style extraction: scripts, remote fonts, animation and complex nested designs are not reproduced pixel for pixel. No language model is called.

## Images and destination compatibility

PNG, JPEG, GIF, WebP and AVIF attachments are supported, including Obsidian `![[image.png]]` embeds and Markdown image references. SVG, PDFs, audio/video and other plugins' dynamic blocks are not embedded as images.

Rich clipboard HTML contains inline styles and embedded image bytes. This proves that the plugin includes the images, but does not guarantee that WeChat or Zhihu will accept or upload them. There is no platform login or image-upload API integration. If a platform rejects pasted images, use the numbered files in the content package; that fallback still requires manual placement. Platform editor paste/upload acceptance has not yet been validated for this release.

Long paragraphs are paginated for Xiaohongshu cards. An oversized indivisible table or image reports an adjustment requirement. Destination limits on text, image count, and X long-form posting depend on the platform and account.

## Network and privacy disclosure

- Reading/selecting a note in the studio, editing in image URLs, retrying images, or completing a copy/export with unresolved images downloads the referenced remote images. The image host receives its URL path/query and normal request metadata. Local attachments stay local.
- Link-based template learning requests the supplied article URL and up to three stylesheets. Requests do not include browser cookies, platform credentials or the entire note body.
- When the system DNS returns a TUN proxy's `198.18.0.0/15` fake addresses, the downloader queries **Cloudflare DNS-over-HTTPS** (`cloudflare-dns.com`) for the target hostname only. It does not send the article body or URL query to that DNS service.
- The downloader validates public addresses and redirects and caps response size and time. It does not execute fetched scripts.
- No telemetry, model service, background polling, automatic synchronization, automatic updates or automatic publication.
- Settings and custom templates are stored in the plugin's `data.json`; exported drafts are stored in the Vault.

See [Data and network details](docs/privacy.md).

## Development

```sh
npm ci
npm run verify
npm run package
npm run demo
```

The optional preview server listens only on `127.0.0.1:39271`. It shares studio and rendering code with the plugin, uses synthetic notes, stores demo settings in browser localStorage, and downloads packages as ZIP files. It cannot read a Vault. Stop it with Ctrl+C.

Source: `src/main.ts` (Obsidian host), `src/ui/studio.ts` (workbench), `src/core/` (rendering, images, templates and export). CI builds and tests the source. [Verification scope](docs/verification.md) · [Community submission guide](docs/submission.md) · [Report an issue](https://github.com/AI-Scarlett/obsidian-content-studio/issues).

## License

MIT © 2026 AI-Scarlett. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
