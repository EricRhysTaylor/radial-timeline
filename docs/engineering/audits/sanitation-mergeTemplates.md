# mergeTemplates Migration Checklist

Generated: 2026-02-20

## Remaining-hit inventory before migration

| File | Lines | What it was doing | Canonical replacement |
| --- | --- | --- | --- |
| `src/utils/beatsTemplates.ts` | `10`, `192`, `198` | Imported and called legacy merge helper inside deprecated `getMergedBeatYaml()`. | Keep deprecated wrapper, but route merging through `mergeTemplateParts(...)` to match canonical behavior without cross-module cycles. |
| `src/utils/yamlTemplateNormalize.ts` | `12`, `121`, `132`, `145` | Used `mergeTemplates` alias for Scene/Beat/Backdrop merge assembly. | Use canonical merge helper module (`mergeTemplateParts`) inside `getTemplateParts()`. |
| `src/utils/sceneGenerator.ts` | `66` | Defined legacy `mergeTemplates()` implementation. | Keep only as deprecated compatibility wrapper over canonical merge helper. |

## Migration notes

- Internal call sites to `mergeTemplates()` were removed.
- `mergeTemplates()` now remains as a deprecated compatibility wrapper only.
- Canonical read path remains `getTemplateParts(...).merged` / `getMergedTemplate(...)`.

## Post-migration state

- Repo search for `mergeTemplates(` returns one hit: the deprecated wrapper in `src/utils/sceneGenerator.ts`.
- The scanner still records one `mergeTemplates` token hit (wrapper declaration only), which is intentional.
