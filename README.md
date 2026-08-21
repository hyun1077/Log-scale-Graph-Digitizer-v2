# Log-scale Graph Digitizer v2

Active engineering digitizer for datasheet time-current / I²t curve extraction, editing, comparison, and analysis.

## Status
This is the active digitizer codebase. Do not use the older `hyun1077/log-digitizer-v2` placeholder for development.

## Deployment
- Vite application in `log-digitizer-vite/`
- GitHub Actions builds the app and publishes generated output to `/docs`
- `vercel.json` also exists; verify the actual Vercel project/domain before removing or changing any deployment configuration

## Planned consolidation
This application is planned to merge with `hyun1077/datasheet-automation-platform` into one Engineering Platform.

Target flow:

```text
PDF datasheet upload
→ document/page analysis
→ product/spec/image extraction
→ curve coordinate extraction
→ human review
→ digitizer workspace
→ engineering comparison / export
```

Keep the Datasheet Automation service and this repository separate until the API contract, asset storage, and deployment path are verified end-to-end.
