import { expect, test } from "bun:test";
import { assessCandidateReport } from "../scripts/check-local-performance-budgets.mjs";

const valid = { route: "/", policy: "CANDIDATE_LOCAL_NOT_APPROVED", samples: [{}, {}, {}],
  metrics: { lcpMs: 2_000, cls: 0.01, scriptBodyBytes: 400_000, interactionFrameMs: null } };
test("candidate budget gate recomputes failures instead of trusting reported success", () => {
  expect(assessCandidateReport(valid)).toEqual([]);
  const failures = assessCandidateReport({ ...valid, status: "PASS", assessments: [], metrics: { ...valid.metrics, lcpMs: 8_000 } });
  expect(failures).toEqual([{ key: "lcpMs", limit: 2_500, measured: 8_000, status: "FAIL" }]);
});
test("missing or non-finite evidence never becomes a budget pass", () => {
  expect(() => assessCandidateReport({ ...valid, samples: [] })).toThrow();
  expect(() => assessCandidateReport({ ...valid, metrics: { ...valid.metrics, lcpMs: null } })).toThrow();
  expect(() => assessCandidateReport({ ...valid, metrics: { ...valid.metrics, cls: NaN } })).toThrow();
  expect(() => assessCandidateReport({ ...valid, policy: "production-ready" })).toThrow();
});
test("ROI requires an interaction measurement and uses the fixed candidate threshold", () => {
  expect(() => assessCandidateReport({ ...valid, route: "/calculators/roi" })).toThrow();
  expect(assessCandidateReport({ ...valid, route: "/calculators/roi", metrics: { ...valid.metrics, interactionFrameMs: 250 } }))
    .toEqual([{ key: "interactionFrameMs", limit: 200, measured: 250, status: "FAIL" }]);
});
