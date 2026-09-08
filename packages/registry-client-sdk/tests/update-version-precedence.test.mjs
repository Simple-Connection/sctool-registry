import {
  RegistryUpdateCandidateError,
  compareSemanticVersionPrecedence,
} from "@simple-connection/sctool-registry-client-sdk/update-candidate";

import { equal, errorCode } from "./update-test-support.mjs";

let cases = 0;

const comparisons = [
  ["1.2.2", "1.2.3", -1, "patch newer"],
  ["1.2.3", "1.2.3", 0, "exact equal"],
  ["2.0.0", "1.9.9", 1, "major newer"],
  ["1.2.3+local", "1.2.3+registry", 0, "build metadata ignored"],
  ["1.2.3-rc.1", "1.2.3", -1, "release exceeds prerelease"],
  ["1.2.3-beta.2", "1.2.3-beta.11", -1, "numeric prerelease ordering"],
  ["1.2.3-1", "1.2.3-alpha", -1, "numeric prerelease below text"],
  ["1.2.3-alpha", "1.2.3-alpha.1", -1, "short prerelease ordering"],
  ["1.2.3-01", "1.2.3-1", 0, "schema-compatible numeric prerelease value"],
  [
    "999999999999999999999.0.0",
    "999999999999999999998.999999999999999999999.999999999999999999999",
    1,
    "large numeric identifiers",
  ],
];

for (const [left, right, expected, label] of comparisons) {
  equal(compareSemanticVersionPrecedence(left, right), expected, label);
  cases += 1;
}

await errorCode(
  () => Promise.resolve(compareSemanticVersionPrecedence("not-semver", "1.0.0")),
  RegistryUpdateCandidateError,
  "invalid-semver",
  "invalid left version rejected",
);
cases += 1;

await errorCode(
  () => Promise.resolve(compareSemanticVersionPrecedence("1.0.0", "not-semver")),
  RegistryUpdateCandidateError,
  "invalid-semver",
  "invalid right version rejected",
);
cases += 1;

export const evidence = Object.freeze({
  id: "GATE_UPDATE_VERSION_PRECEDENCE",
  status: "PASS",
  cases,
  details: Object.freeze({
    grammar: "PACKAGE_SCHEMA_V2_SEMVER",
    build_metadata_ignored: true,
    prerelease_semver_precedence: true,
    numeric_prerelease_integer: true,
    large_numeric_integer_safe: true,
  }),
});

console.log(`Registry update version precedence PASS cases=${cases}`);
