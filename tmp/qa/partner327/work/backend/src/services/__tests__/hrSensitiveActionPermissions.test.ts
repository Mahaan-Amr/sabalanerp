import assert from "node:assert/strict";
import {
  actionPermissionsForLegacyAuthority,
  getHrActionPermissionDefinition,
} from "../hrActionPermissionCatalog";

for (const code of [
  "REVIEW_IDENTITY_DOCUMENTS",
  "APPROVE_IDENTITY_CLEARANCE",
  "MANAGE_COLLATERAL_REQUIREMENTS",
  "RECORD_COLLATERAL_CUSTODY",
  "VERIFY_COLLATERAL_CUSTODY",
]) {
  assert.ok(getHrActionPermissionDefinition(code), `${code} must be separately grantable`);
}

assert.ok(actionPermissionsForLegacyAuthority("FINANCE_RECORDER").includes("RECORD_COLLATERAL_CUSTODY"));
assert.ok(!actionPermissionsForLegacyAuthority("FINANCE_RECORDER").includes("VERIFY_COLLATERAL_CUSTODY"));
assert.ok(actionPermissionsForLegacyAuthority("FINANCE_MANAGER").includes("VERIFY_COLLATERAL_CUSTODY"));
assert.ok(!actionPermissionsForLegacyAuthority("FINANCE_MANAGER").includes("RECORD_COLLATERAL_CUSTODY"));
assert.ok(
  actionPermissionsForLegacyAuthority("HR_PROCESSOR").includes("REVIEW_IDENTITY_DOCUMENTS"),
);
assert.ok(
  actionPermissionsForLegacyAuthority("HR_MANAGER").includes("APPROVE_IDENTITY_CLEARANCE"),
);

console.log("HR sensitive action permission tests passed.");
