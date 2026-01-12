Onboarding

UI: /onboarding

API: /api/onboarding/status, /api/onboarding/complete, /api/onboarding/reset

Work Orders

UI: /work-orders, /inbox

API: /api/gmail/process, /api/work-orders, /api/work-orders/export

Signed Matching

Domains

Work Orders: intake → parse → sheet/db → export

Signed: upload → process-pdf → ocr/ai → match → verify/resolve

Onboarding: connect google → create folder/sheet → bootstrap workspace

Workspace: update/reset workspace ids

Utilities: pdf helpers

Entry points

UI: /onboarding, /inbox, /work-orders, /settings

API: /api/gmail/process, /api/work-orders, /api/signed/process, /api/upload-pdf, /api/process-pdf, /api/onboarding/*

This becomes your “I’m not lost” document.
Core domains

Work Orders: gmail intake → parse → write to sheets/db → export

Signed Docs: upload → process-pdf → OCR/AI fallback → match → verify/resolve

Onboarding: connect Google → create folder/sheet → bootstrap workspace

Workspace & Settings: list folders/spreadsheets, store IDs

Entry points

UI: /onboarding, /inbox, /work-orders, /settings

API:

/api/gmail/process

/api/inbound-email

/api/work-orders + /api/work-orders/export

/api/upload-pdf, /api/process-pdf

/api/signed/* (needs-review, override, process, resolve, verification)

/api/pdf/* (render-page, normalize, info, detect-raster)

/api/onboarding/*

/api/user-settings/*

/api/workspace/*

Folder rules

app/ only contains user-visible pages

app/api/ only contains public API routes

Experiments go in _experimental/ or never get committed

No free/ or pro/ folders — plans are feature flags, not routes

Business logic lives in lib/<domain>/, never in app/