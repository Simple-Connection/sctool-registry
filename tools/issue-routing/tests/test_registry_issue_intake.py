import importlib.util
import json
import pathlib
import sys
import unittest

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "registry_issue_intake.py"
SCHEMA_PATH = pathlib.Path(__file__).resolve().parents[1] / "product-report.schema.json"
spec = importlib.util.spec_from_file_location("registry_issue_intake", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


class RegistryIssueIntakeTests(unittest.TestCase):
    def setUp(self):
        self.route = {
            "mode": "CURRENT_VERSION",
            "target_branch": "dev/1.0.3",
            "target_version": "1.0.3",
        }

    def product_report(self, *, report_id="product-1", severity="NORMAL", extra=None):
        payload = {
            "schema": mod.PRODUCT_REPORT_SCHEMA,
            "report_id": report_id,
            "kind": "VALIDATION_FAILURE",
            "severity": severity,
            "fingerprint": "marketplace-profile-features-empty",
            "source": {
                "repository": "Simple-Connection/SC_Linked_App",
                "branch": "dev/2.2.4",
                "head": "e56cfe76ebcc1f6c41a0789910e7a5c580a439b1",
                "session": "P4",
                "work_item": "P4-W3",
            },
            "package": {
                "id": "example.tool",
                "version": "1.2.3",
                "artifact_sha256": "a" * 64,
                "profile_schema_version": "1.0.0",
            },
            "failure": {
                "operation": "MARKETPLACE_VALIDATION",
                "code": "MARKETPLACE_PROFILE_REQUIRED_SECTION_EMPTY",
                "path": "marketplaceProfile.features",
                "observed": "empty",
                "expected": "non-empty content",
                "repair_hint": "Add at least one feature entry.",
                "evidence_ref": "registry-validation:rule/MARKETPLACE_PROFILE_REQUIRED_SECTION_EMPTY",
            },
            "sdk": {
                "package": "@simple-connection/sctool-sdk",
                "version": "1.0.3",
                "contract": "marketplace-profile/v1",
            },
        }
        if extra:
            payload.update(extra)
        return f"{mod.PRODUCT_REPORT_MARKER_START}\n{json.dumps(payload)}\n{mod.REPORT_MARKER_END}"

    def sdk_report(self, report_id="sdk-1", severity="NORMAL"):
        payload = {
            "schema": mod.SDK_REPORT_SCHEMA,
            "report_id": report_id,
            "kind": "SDK_ERROR",
            "severity": severity,
            "source": {
                "repository": "Simple-Connection/SC_Linked_App",
                "branch": "dev/2.2.4",
                "head": "sdk-head",
            },
            "sdk": {"package": "@simple-connection/sctool-registry-client-sdk", "version": "0.2.0"},
        }
        return f"{mod.SDK_REPORT_MARKER_START}\n{json.dumps(payload)}\n{mod.REPORT_MARKER_END}"

    def test_product_schema_file_binds_marker_schema_identity(self):
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        self.assertEqual(schema["properties"]["schema"]["const"], mod.PRODUCT_REPORT_SCHEMA)
        self.assertEqual(mod.PRODUCT_REPORT_SCHEMA, "sctool-registry-product-report/v1")
        self.assertEqual(mod.PRODUCT_REPORT_MARKER_START, "<!-- sctool-registry-product-report:v1")
        self.assertFalse(schema["additionalProperties"])

    def test_parse_current_index(self):
        state = mod.parse_current_index(
            'current:\n'
            '  distribution_contract_version: "1.0.3"\n'
            '  branch: "dev/1.0.3"\n'
            '  state: ACTIVE\n'
            '  migrations:\n'
            '    machine_routing: COMPLETE\n'
            '\nversions:\n'
        )
        self.assertEqual(state.version, "1.0.3")
        self.assertEqual(state.branch, "dev/1.0.3")
        self.assertTrue(state.active)

    def test_selects_single_active_version(self):
        route = mod.select_route(
            [
                mod.BranchState("dev/1.0.2", "1.0.2", "HISTORICAL_COMPLETE"),
                mod.BranchState("dev/1.0.3", "1.0.3", "ACTIVE"),
            ]
        )
        self.assertEqual(route["mode"], "CURRENT_VERSION")
        self.assertEqual(route["target_branch"], "dev/1.0.3")

    def test_no_active_version_routes_to_next_version_queue(self):
        route = mod.select_route(
            [mod.BranchState("dev/1.0.2", "1.0.2", "HISTORICAL_COMPLETE")]
        )
        self.assertEqual(route["mode"], "NEXT_VERSION_QUEUE")
        self.assertIsNone(route["target_branch"])

    def test_stale_unmerged_state_is_not_active_after_branch_is_merged_to_main(self):
        route = mod.select_route(
            [mod.BranchState("dev/1.0.2", "1.0.2", "IN_PROGRESS_ACTIVE_SESSION", ahead_by=0)]
        )
        self.assertEqual(route["mode"], "NEXT_VERSION_QUEUE")

    def test_multiple_active_versions_fail_closed(self):
        route = mod.select_route(
            [
                mod.BranchState("dev/1.0.2", "1.0.2", "IN_PROGRESS_ACTIVE_SESSION"),
                mod.BranchState("dev/1.0.3", "1.0.3", "ACTIVE"),
            ]
        )
        self.assertEqual(route["mode"], "ROUTING_BLOCKED")
        self.assertEqual(route["candidates"], ["dev/1.0.2", "dev/1.0.3"])

    def test_existing_sdk_report_contract_is_preserved(self):
        report = mod.parse_report(self.sdk_report())
        self.assertEqual(report["schema"], mod.SDK_REPORT_SCHEMA)
        self.assertEqual(mod.REPORT_SCHEMA, mod.SDK_REPORT_SCHEMA)
        self.assertEqual(mod.REPORT_MARKER_START, mod.SDK_REPORT_MARKER_START)

    def test_product_report_parses_as_separate_schema(self):
        report = mod.parse_report(self.product_report())
        self.assertEqual(report["schema"], mod.PRODUCT_REPORT_SCHEMA)
        self.assertEqual(report["failure"]["path"], "marketplaceProfile.features")
        self.assertEqual(report["sdk"]["version"], "1.0.3")

    def test_product_report_rejects_unknown_secret_field(self):
        body = self.product_report(extra={"access_token": "should-never-be-captured"})
        with self.assertRaises(mod.IntakeError):
            mod.parse_report(body)

    def test_product_report_rejects_raw_log_field(self):
        payload = json.loads(self.product_report().split("\n", 1)[1].rsplit("\n", 1)[0])
        payload["failure"]["raw_log"] = "unsanitized output"
        body = f"{mod.PRODUCT_REPORT_MARKER_START}\n{json.dumps(payload)}\n{mod.REPORT_MARKER_END}"
        with self.assertRaises(mod.IntakeError):
            mod.parse_report(body)

    def test_product_report_rejects_credential_pattern_in_copy_safe_field(self):
        payload = json.loads(self.product_report().split("\n", 1)[1].rsplit("\n", 1)[0])
        payload["failure"]["observed"] = "Bearer abcdefghijklmnopqrstuvwxyz123456"
        body = f"{mod.PRODUCT_REPORT_MARKER_START}\n{json.dumps(payload)}\n{mod.REPORT_MARKER_END}"
        with self.assertRaises(mod.IntakeError):
            mod.parse_report(body)

    def test_issue_with_both_marker_kinds_fails_closed(self):
        with self.assertRaises(mod.IntakeError):
            mod.parse_report(self.sdk_report() + "\n" + self.product_report())

    def test_build_queue_filters_non_reports_and_sorts_blockers_first(self):
        queue = mod.build_queue(
            [
                {"number": 8, "body": self.sdk_report("normal", "NORMAL")},
                {"number": 7, "body": "ordinary issue"},
                {"number": 9, "body": self.sdk_report("blocker", "BLOCKER")},
            ],
            self.route,
        )
        self.assertEqual([item["issue_number"] for item in queue["issues"]], [9, 8])
        self.assertEqual(queue["issues"][0]["report_id"], "blocker")
        self.assertEqual(queue["issues"][0]["report_kind"], "SDK")

    def test_mixed_sdk_and_product_reports_share_backward_compatible_queue(self):
        queue = mod.build_queue(
            [
                {"number": 11, "body": self.sdk_report("sdk-normal", "NORMAL")},
                {"number": 12, "body": self.product_report(report_id="product-blocker", severity="BLOCKER")},
            ],
            self.route,
        )
        self.assertEqual(queue["schema"], "sctool-registry-sdk-issue-queue/v1")
        self.assertEqual([item["report_kind"] for item in queue["issues"]], ["PRODUCT_PACKAGE", "SDK"])
        product = queue["issues"][0]
        self.assertEqual(product["failure_code"], "MARKETPLACE_PROFILE_REQUIRED_SECTION_EMPTY")
        self.assertEqual(product["failure_path"], "marketplaceProfile.features")
        self.assertEqual(product["product_fingerprint"], "marketplace-profile-features-empty")
        self.assertNotIn("observed", product)
        self.assertNotIn("repair_hint", product)


if __name__ == "__main__":
    unittest.main()
