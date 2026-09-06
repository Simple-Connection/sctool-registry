#!/usr/bin/env python3
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from validation.session_state_sync import synchronize_session_states


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


class SessionStateSyncTest(unittest.TestCase):
    def test_closeout_updates_plan_index_and_next_pointers_together(self):
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


if __name__ == "__main__":
    unittest.main()
