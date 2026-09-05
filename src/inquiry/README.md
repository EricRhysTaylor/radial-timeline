# Inquiry Architecture Guidelines

- `InquiryView.ts` is the controller/orchestrator for Inquiry.
- Keep lifecycle, shell composition, refresh sequencing, async coordination, and policy/state decisions in the view.
- Keep repeated mechanisms shared:
  - constants/config
  - DOM helpers
  - event binding helpers
  - common render helpers
  - common types
- Keep subsystem meaning local:
  - `briefing/*`
  - `engine/*`
  - `corpus/*`
  - future subsystem folders only when a real seam emerges
- Share the machinery, keep the meaning local.
- Do not extract code just to reduce line count.
- Do not duplicate identical mechanisms across subsystems.
