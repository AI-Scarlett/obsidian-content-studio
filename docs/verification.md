# Verification scope for 0.1.1

Validated on 2026-09-07. Run `npm ci && npm run verify && npm run package` to reproduce automated verification. CI runs the same checks. Tests use synthetic fixtures and do not need platform accounts or a private Vault.

## Automated checks

60 tests cover Markdown and inline HTML rendering, sanitization, six templates, style extraction and validation, link references, X weighted-character splitting and lossless reassembly, public-network validation, attachment embedding, ordered concurrent image downloads, retry/cache handling, missing-image copy/export guards, image additions before rendering finishes, stale async results, portable image files, separate title/body copying (with images and body headings preserved), and the compiled plugin with a mocked Obsidian host.

TypeScript checking, plugin/demo bundling, and production dependency audit passed. The release package includes readable bundled JavaScript. The installed plugin does not need node_modules or external runtime data files.

## Manual validation

The shared browser workbench was exercised with synthetic notes for platform/template switching, clipboard formats, persistent custom templates, link style learning and image-card export. A long synthetic article produced 17 cards without lost paragraphs. PNG exports were 1080 × 1440.

Native Obsidian 1.13.7 on macOS was used to verify plugin registration, note selection, content-package saving and usable controls in a split pane. Responsive layout follows the plugin pane width: three columns on wide panes, a top template strip at intermediate widths, and a scrollable single column on narrow panes.

A separate local integration check downloaded all 11 images from a real note using the production downloader; the renderer retained 11 embedded images and the portable export contained 11 image files, with no image warnings. Private notes, their images, native screenshots and machine-specific logs are excluded from the repository and releases.

## Limits of this evidence

- Rich clipboard HTML includes image bytes; actual WeChat, Zhihu, Xiaohongshu and X editor acceptance is not yet verified.
- Native runtime validation used Obsidian 1.13.7. The declared minimum version is not a separately tested runtime.
- Template learning was verified using public sample pages and synthetic article HTML. Specific reference pages may require login or fail extraction.
- Mobile is unsupported. The plugin does not rewrite content with AI, upload media to a publishing platform, or publish automatically.
