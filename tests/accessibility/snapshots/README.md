# Visual baselines

Current continuation:twelve baselines cover sign-in, registration and ROI main layouts in EN/AR desktop/mobile. Seven deliberate changes were agent-inspected:two desktop sign-ins and Arabic desktop registration reserve measured font-wrap space; four ROI layouts reflect localized templates/RTL numeric isolation/alignment. The overlay mask now uses `[data-consent-banner]`, not an English accessible label; Arabic mobile auth layouts match unchanged baselines. Final packaged non-updating full suite54/54, including all twelve comparisons, passed. Arabic ROI UI is implemented but native-language/legal/design approval remains pending.

These snapshots cover the static sign-in main/form layout at 1280x900 and 390x844 in EN/LTR and AR/RTL. Baselines were deliberately refreshed on 2026-09-26 for localized auth copy and inspected by the implementation agent; subsequent non-updating comparison passed. They capture the current implementation and do not establish design acceptance, language quality, translation completeness or accessibility conformance. Human baseline/native-language review is pending.

Run comparisons using the pinned Playwright/Chromium Docker image:

```powershell
docker compose --env-file NUL --profile test run --no-deps --rm accessibility bun --no-env-file run test:a11y visual-regression.spec.ts
```

To regenerate intentionally, bind this directory's parent into the Docker test container so generated PNGs persist, then inspect and review the changes before accepting them:

```powershell
docker compose --env-file NUL --profile test run --no-deps --rm -v "${PWD}/tests/accessibility:/app/tests/accessibility" accessibility bun --no-env-file run test:a11y visual-regression.spec.ts --update-snapshots
```

The main/form snapshots omit header, cookie-consent and fixed mobile navigation overlays, use fresh unauthenticated browser contexts, wait for local fonts, disable animations, hide the caret, and fix locale/timezone/color preference. The pixel comparison permits at most 0.1% changed pixels. Navigation and API consent enforcement have separate browser/integration coverage; the omitted overlays have no snapshot coverage here. All contexts block browser HTTP requests to origins other than the configured local application, and service workers are disabled. Compare baselines on Linux inside the pinned Docker image; host-platform font rendering is not an interchangeable baseline.
