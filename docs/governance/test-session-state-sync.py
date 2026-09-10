#!/usr/bin/env python3
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from validation.session_state_sync import (
    project_next_session,
    synchronize_next_session_projection,
    synchronize_session_states,
)


STATE_RULES = {
    "plan_state_map": {
        "COMPLETE": "CLOSED",
        "ACTIVE": "ACTIVE",
        "BLOCKED": "BLOCKED",
        "APPROVED": "ACTIVE",
        "AWAITING_APPROVAL": "AWAITING_APPROVAL",
        "NOT_APPROVED": "AWAITING_APPROVAL",
    },
    "canonical_plan_state_for_derived": {
        "CLOSED": "COMPLETE",
        "ACTIVE": "ACTIVE",
        "BLOCKED": "BLOCKED",
        "AWAITING_APPROVAL": "NOT_APPROVED",
    },
    "derivation": {
        "approved_value": "APPROVED",
        "unapproved_state": "AWAITING_APPROVAL",
        "blocked_state": "BLOCKED",
        "closed_state": "CLOSED",
        "fallback_state": "ACTIVE",
        "blocking_work_unit_statuses": ["BLOCKED"],
        "blocking_gate_statuses": ["BLOCKED", "FAIL"],
        "closed_work_unit_status": "COMPLETE",
        "closed_gate_status": "PASS",
        "require_nonempty_work_units_for_closed": True,
        "require_nonempty_required_gates_for_closed": True,
    },
}


def closed_doc():
    return {
        "session": {"approval": "APPROVED"},
        "work_units": [{"id": "W1", "status": "COMPLETE"}],
        "gates": [{"id": "G1", "required": True, "status": "PASS"}],
    }


def p1_to_p2_plan():
    return {
        "version": {"distribution_contract_version": "1.0.3"},
        "sessions": [
            {
                "id": "P1",
                "state": "COMPLETE",
                "document": "docs/P1.yaml",
                "planning_state": "CONCRETIZED",
                "planning_document": "docs/P1-work-plan.yaml",
            },
            {
                "id": "P2",
                "state": "NOT_APPROVED",
                "document": None,
                "planning_state": "CONCRETIZED",
                "planning_document": "docs/P2-work-plan.yaml",
            },
        ],
        "next": {"session_id": "P2", "state": "NOT_APPROVED"},
    }


class SessionStateSyncTest(unittest.TestCase):
    def test_same_session_state_projection(self):
        plan = {
            "version": {"distribution_contract_version": "1.0.2"},
            "sessions": [
                {
                    "id": "P5",
                    "state": "ACTIVE",
                    "document": "docs/P5.yaml",
                }
            ],
            "next": {"session_id": "P5", "state": "ACTIVE"},
        }
        index = {
            "current": {
                "next_session": {
                    "id": "P5",
                    "state": "ACTIVE",
                    "document": "docs/P5.yaml",
                }
            },
            "versions": {
                "1.0.2": {
                    "sessions": [
                        {
                            "id": "P5",
                            "state": "ACTIVE",
                            "document": "docs/P5.yaml",
                        }
                    ]
                }
            },
        }

        changes = synchronize_session_states(
            plan,
            index,
            STATE_RULES,
            lambda _: closed_doc(),
        )

        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0].derived_state, "CLOSED")
        self.assertEqual(plan["sessions"][0]["state"], "COMPLETE")
        self.assertEqual(index["versions"]["1.0.2"]["sessions"][0]["state"], "COMPLETE")
        self.assertEqual(index["current"]["next_session"]["state"], "COMPLETE")
        self.assertEqual(plan["next"]["state"], "COMPLETE")

    def test_already_consistent_active_session_is_not_rewritten(self):
        plan = {
            "version": {"distribution_contract_version": "1.0.2"},
            "sessions": [
                {
                    "id": "P6",
                    "state": "ACTIVE",
                    "document": "docs/P6.yaml",
                }
            ],
        }
        index = {
            "current": {},
            "versions": {
                "1.0.2": {
                    "sessions": [
                        {
                            "id": "P6",
                            "state": "ACTIVE",
                            "document": "docs/P6.yaml",
                        }
                    ]
                }
            },
        }
        active = closed_doc()
        active["work_units"][0]["status"] = "PENDING"

        before_plan = copy.deepcopy(plan)
        before_index = copy.deepcopy(index)
        changes = synchronize_session_states(
            plan,
            index,
            STATE_RULES,
            lambda _: active,
        )

        self.assertEqual(changes, [])
        self.assertEqual(plan, before_plan)
        self.assertEqual(index, before_index)

    def test_completed_session_advances_to_next_planned_session_projection(self):
        plan = p1_to_p2_plan()
        expected = {
            "id": "P2",
            "state": "NOT_APPROVED",
            "document": None,
            "planning_state": "CONCRETIZED",
            "planning_document": "docs/P2-work-plan.yaml",
        }
        self.assertEqual(project_next_session(plan), expected)

    def test_next_session_projection_repairs_missing_planning_metadata(self):
        plan = p1_to_p2_plan()
        index = {
            "current": {
                "current_session": None,
                "current_session_document": None,
                "next_session": {"id": "P2", "state": "NOT_APPROVED"},
            }
        }

        change = synchronize_next_session_projection(plan, index)

        self.assertIsNotNone(change)
        self.assertEqual(
            index["current"]["next_session"],
            {
                "id": "P2",
                "state": "NOT_APPROVED",
                "document": None,
                "planning_state": "CONCRETIZED",
                "planning_document": "docs/P2-work-plan.yaml",
            },
        )

    def test_next_session_projection_is_idempotent(self):
        plan = p1_to_p2_plan()
        index = {"current": {"next_session": project_next_session(plan)}}
        before = copy.deepcopy(index)

        change = synchronize_next_session_projection(plan, index)

        self.assertIsNone(change)
        self.assertEqual(index, before)

    def test_final_session_sets_next_session_null(self):
        plan = {
            "version": {"distribution_contract_version": "1.0.3"},
            "sessions": [{"id": "P3", "state": "COMPLETE", "document": "docs/P3.yaml"}],
            "next": {"session_id": None, "state": None},
        }
        index = {"current": {"next_session": {"id": "P3", "state": "COMPLETE"}}}

        change = synchronize_next_session_projection(plan, index)

        self.assertIsNotNone(change)
        self.assertIsNone(index["current"]["next_session"])

    def test_unknown_next_session_is_rejected(self):
        plan = p1_to_p2_plan()
        plan["next"]["session_id"] = "P9"

        with self.assertRaisesRegex(ValueError, "NEXT_SESSION_PROJECTION_UNKNOWN_SESSION:P9"):
            project_next_session(plan)


if __name__ == "__main__":
    unittest.main()
