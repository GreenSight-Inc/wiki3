---
paths:
  - "frontend/src/css/_print.scss"
  - "frontend/src/components/PageHeader.vue"
  - "backend/api/pages.ts"
---

# Printed pages

`frontend/src/css/_print.scss` turns the app shell into normal flow on paper and hides the chrome.
What the header adds for paper only is not there.

- **Print-only header markup lives in the scoped style of `PageHeader.vue`.** `.page-header-print-meta`
  (the "Last edited by" line) and `.page-header-print-qr` (the QR code) are `display: none` on screen
  and shown under `@media print` in that file, not in `_print.scss`. The `display: none` belongs to
  the component, and no `_print.scss` rule competes with these classes.
- **Set the colour on paper.** The header paints a light foreground in the dark theme, which prints
  white on white. `.page-header-print-meta` sets `#333`.
- **A print-only SVG needs its own `width` and `height` attributes.** An SVG sized by a stylesheet
  alone collapses to nothing on paper. `printQrCodeFor` in `api/pages.ts` passes `width: 74` to
  `qrcode`, which writes both attributes.
- **Inline SVG, never an `<img>` with a data URI** (browsers leave it off the printed sheet), and a
  flex item of the header row, never a float (the print layout drops floats).
- **The last-edited line follows the screen switches**: `features.lastEditedBy`, the page's
  `showLastEditedBy`, and no editor open. The QR code is `features.printQrCode`, off by default, and
  `printQrCode` on the page fetch is null while it is off.
- The version view header (`PageVersionHeader.vue`) prints neither.
