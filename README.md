# Mogao Content Studio

English | [简体中文](README.zh-CN.md)

Format Obsidian notes for WeChat Official Accounts, Zhihu, Xiaohongshu and X. Choose one of six built-in templates, adjust typography and colors, or learn reusable styles from an article URL. The interface is currently in Simplified Chinese.

Desktop only. Version 0.1.3. Requires Obsidian 1.8.7 or later; earlier native validation used 1.13.7. Version 0.1.3 has automated host and DOM regression coverage. Formatting preserves your source text and runs locally. No AI account, API key or automatic publishing is required.

## Features

| Destination | Output |
| --- | --- |
| WeChat | Native DOCX with embedded media, rich text, HTML, Markdown and optional link references |
| Zhihu | Rich text and Markdown with headings, quotations, lists, code and tables |
| Xiaohongshu | Separate captions, numbered original images and content-paginated 1080 × 1440 PNG cards |
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
4. For WeChat with images, use **导出 Word 图文**, then import `article.docx` in the platform's document importer. The file embeds media at their original positions. Copy the title separately. Platform import may remap styles; check the destination preview.
5. For Xiaohongshu, choose **导出发布图片** and either export cards (text and images flattened together to preserve their arrangement) or original images (caption remains separate). Bulk-select the numbered files on the platform. Split oversized decks according to the destination's current image limits; exports are never silently truncated.
6. Title and body remain separate copy actions. Review the result in the destination and publish manually.

Each export creates a new folder under `墨稿导出/` by default, configurable in plugin settings. Packages include `article.html`, `article.md`, `title.txt`, `caption.txt`, `template.json`, `manifest.json`, and numbered image files. Markdown references are rewritten to the image files. HTML embeds the image bytes. Xiaohongshu exports additional PNG cards; X exports separate thread text files.

Draft edits are held in the open studio until exported; export before closing or reloading. Export manifests include the source note's relative path, so treat them as part of your private writing material.

## Learn styles from a link

**链接学模板** reads a public article and up to three stylesheets, extracts constrained typography, colors, headings and quotation styles, and previews them against your draft. Save the result with a name. Template JSON retains provenance and extraction notes, without copying the reference article's body.

For a login page, verification challenge or failed download, use **粘贴 HTML** with article HTML you can access. This is static style extraction: scripts, remote fonts, animation and complex nested designs are not reproduced pixel for pixel. No language model is called.

## Images and destination compatibility

PNG, JPEG, GIF, WebP and AVIF attachments are supported, including Obsidian `![[image.png]]` embeds and Markdown image references. SVG, PDFs, audio/video and other plugins' dynamic blocks are not embedded as images.

Clipboard HTML contains embedded image bytes, which platform editors can reject. The plugin no longer claims that copying uploaded the images. Use native DOCX import for WeChat and bulk image upload for Xiaohongshu. These are local export workflows, with no platform login or upload API integration. Actual platform import/upload acceptance remains a separate validation step.

DOCX retains basic paragraph and inline formatting, lists, tables, links and embedded images. It simplifies template decorations and maps light text to readable ink on a white page. WebP/AVIF/GIF become PNG (GIF is static); oversized images are bounded to 2000 px on their longest edge. Platform exports include separate `title.txt` and `body.txt`. Content package `caption.txt` contains the body only.

Long paragraphs are paginated for Xiaohongshu cards. An oversized indivisible table or image reports an adjustment requirement. Destination limits on text, image count, and X long-form posting depend on the platform and account.

## Network and privacy disclosure

- Reading/selecting a note in the studio, editing in image URLs, retrying images, or completing a copy/export with unresolved images downloads the referenced remote images. The image host receives its URL path/query and normal request metadata. Local attachments stay local.
- Link-based template learning requests the supplied article URL and up to three stylesheets. Requests do not include browser cookies, platform credentials or the entire note body.
- When the system DNS returns a TUN proxy's `198.18.0.0/15` fake addresses, the downloader queries **Cloudflare DNS-over-HTTPS** (`cloudflare-dns.com`) for the target hostname only. It does not send the article body or URL query to that DNS service.
- The downloader validates public addresses and redirects and caps response size and time. It does not execute fetched scripts.
- No telemetry, model service, background polling, automatic synchronization, automatic updates or automatic publication.
- Vault enumeration occurs only when the user opens the note picker: it lists Markdown note paths for selection, without bulk-reading their bodies or transmitting the list. Opening the plugin or formatting the current note does not enumerate the Vault.
- Clipboard access is write-only, triggered by the copy buttons. The plugin never reads the clipboard, monitors it, or uploads clipboard contents.
- Settings and custom templates are stored in the plugin's `data.json`; exported drafts are stored in the Vault.

See [Data and network details](docs/privacy.md).

## Development

```sh
npm ci
npm run verify
npm run package
```

`npm run verify` includes the official Obsidian ESLint recommended rules (zero warnings required), CSS lint, type checks, and 74 regression tests. CSS is also checked against a conservative Chrome 120 compatibility profile. The development browser prototype was removed from the plugin source in 0.1.2; run the workbench inside Obsidian to test actual Vault behavior.

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
