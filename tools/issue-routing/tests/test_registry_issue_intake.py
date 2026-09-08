import importlib.util
import json
import pathlib
import sys
import unittest

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "registry_issue_intake.py"
spec = importlib.util.spec_from_file_location("registry_issue_intake", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


class RegistryIssueIntakeTests(unittest.TestCase):
    def test_parse_current_index(self):
        state = mod.parse_current_index(
            'current:\n'
            '  distribution_contract_version: "1.0.2"\n'
            '  branch: "dev/1.0.2"\n'
            '  state: IN_PROGRESS_ACTIVE_SESSION\n'
            '  migrations:\n'
            '    machine_routing: COMPLETE\n'
            '\nversions:\n'
        )
        self.assertEqual(state.version, "1.0.2")
        self.assertEqual(state.branch, "dev/1.0.2")
        self.assertTrue(state.active)

    def test_selects_single_active_version(self):
        route = mod.select_route(
            [
                mod.BranchState("dev/1.0.1", "1.0.1", "HISTORICAL_COMPLETE"),
                mod.BranchState("dev/1.0.2", "1.0.2", "IN_PROGRESS_ACTIVE_SESSION"),
            ]
        )
        self.assertEqual(route["mode"], "CURRENT_VERSION")
        self.assertEqual(route["target_branch"], "dev/1.0.2")

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
                mod.BranchState("dev/1.0.3", "1.0.3", "IN_PROGRESS_AWAITING_SESSION"),
            ]
        )
        self.assertEqual(route["mode"], "ROUTING_BLOCKED")
        self.assertEqual(route["candidates"], ["dev/1.0.2", "dev/1.0.3"])

    def test_build_queue_filters_non_reports_and_sorts_blockers_first(self):
        def report(report_id, severity, number):
            payload = {
                "schema": mod.REPORT_SCHEMA,
                "report_id": report_id,
                "kind": "SDK_ERROR",
                "severity": severity,
                "source": {
                    "repository": "Simple-Connection/SC_Linked_App",
                    "branch": "dev/2.2.4",
                    "head": f"sha-{number}",
                },
                "sdk": {"package": "@simple-connection/sctool-registry-client-sdk", "version": "0.1.0"},
            }
            return f"{mod.REPORT_MARKER_START}\n{json.dumps(payload)}\n{mod.REPORT_MARKER_END}"

        route = {
            "mode": "CURRENT_VERSION",
            "target_branch": "dev/1.0.2",
            "target_version": "1.0.2",
        }
        queue = mod.build_queue(
            [
                {"number": 8, "body": report("normal", "NORMAL", 8)},
                {"number": 7, "body": "ordinary issue"},
                {"number": 9, "body": report("blocker", "BLOCKER", 9)},
            ],
            route,
        )
        self.assertEqual([item["issue_number"] for item in queue["issues"]], [9, 8])
        self.assertEqual(queue["issues"][0]["report_id"], "blocker")


if __name__ == "__main__":
    unittest.main()
