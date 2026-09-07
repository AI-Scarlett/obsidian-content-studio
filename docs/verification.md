# Verification scope for 0.1.2

Run `npm ci && npm run verify && npm run package` using Node.js 22.15+ to reproduce verification. Source checks use `eslint-plugin-obsidianmd` 0.4.2's complete recommended rules with zero warnings allowed. CSS checks prohibit `!important` and use a conservative Chrome 120 compatibility profile. No Obsidian source rule is disabled.

68 offline tests cover rendering, sanitization, template extraction/validation, style adjustments, X weighted-character splitting, public-address/redirect protection, Obsidian requestUrl DNS integration, image ordering/retry/cache/completeness, separate title/body copying, standalone image packages, the compiled plugin host, settings validation/search definitions, user-triggered note enumeration, and write-only clipboard behavior.

Card regression tests check CSS dimensions (720 × 960 before 1.5× PNG export), cover/body content and sanitized card input. These DOM tests do not measure actual browser pagination or replace native visual validation. Earlier browser/native checks exercised 1080 × 1440 cards and Obsidian 1.13.7, but native 0.1.2 behavior has not yet been rechecked after the DOM refactor.

Earlier real-note integration retained all 11 images in rendered HTML and the exported image files. Private notes, images, screenshots and machine-specific logs are excluded from the repository. The 0.1.2 regression suite uses synthetic fixtures.

GitHub Actions repeats verification, builds from the exact version tag, and produces artifact attestations. Release assets are downloaded and checked against both their provenance and the local build. Only `main.js`, `manifest.json` and `styles.css` are attached to the release; optional ZIP/checksum packages are retained in Actions artifacts.

Actual WeChat, Zhihu, Xiaohongshu and X editor acceptance is not yet verified. Mobile is unsupported. Static template learning does not reproduce dynamic articles pixel for pixel or call an AI service. The plugin does not upload media to platforms or publish automatically.
