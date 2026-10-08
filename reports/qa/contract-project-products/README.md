# Project and product presentation harmonization — 2026-10-07

Ordinary CRM project entry and both Partner creation paths now consume `CustomerProjectFormFields`. Labels, multiline address, searchable project type with a meaningful empty choice, section icons, spacing, and canonical controls share one implementation. Partner cards now retain server-provided address, city, and manager details. Partner sheets have Add and Cancel actions; the redundant success notice no longer follows the user into products. Catalog filters use the ordinary short labels and the existing shared catalog sizing.

Validation:

- Design-system check, foundation (25 tests), adoption (14 tests): passed.
- Shared contract step views, catalog availability, CRM workflow: 7 tests passed.
- Frontend production compilation, type checking, and build: passed with existing unrelated lint warnings.
- Targeted Partner creation E2E: passed, including project address/city, shared form, disabled invalid submit, cancellation, keyboard selection, mobile dark presentation, and accessibility scan. First attempt crashed in the Windows worker before test execution; retry after the production build completed passed.
- `verify.mjs`: ordinary and Partner form fields have identical measured font sizes and control heights (14px, 46px inputs, 86px textarea). Project lists/forms inspected at 1280px and 390px in both themes; compact Partner product tabs verified. Screenshots and measurements are stored alongside this report. Partner APIs are mocked; no project or contract was submitted. Ordinary recovery may create an unfinished local test draft.

Runtime uses only the existing healthy `sabalanerp-local` services. Source changes were synchronized to the existing frontend development container for browser verification, then the frontend image was rebuilt with the normal Compose configuration. The earlier backend preview-number synchronization and its image-download limitation remain documented in the first-two-steps report.
