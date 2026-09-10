#!/usr/bin/env python3
from __future__ import annotations

import copy
import hashlib
import sys
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "docs" / "governance"))

from validation.task_contract import validate_bound_task


PLAN_PATH = (
    ROOT
    / "docs"
    / "ver1.0.3"
    / "session_document"
    / "ver.1.0.3_P1_sctool_sdk_marketplace_profile_work_plan.yaml"
)
TASK_PATH = ROOT / "docs" / "ver1.0.3" / "source" / "sctool-sdk-1.0.3-task.yaml"


class FakeContext:
    def __init__(self, root: Path):
        self.root = root

    def load(self, rel: str):
        return yaml.safe_load((self.root / rel).read_text(encoding="utf-8"))


class TaskContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = yaml.safe_load(PLAN_PATH.read_text(encoding="utf-8"))

    def _validate(self, plan):
        errors = []
        validate_bound_task(FakeContext(ROOT), "P1", plan, errors)
        return errors

    def test_current_plan_matches_source_task(self):
        self.assertEqual(self._validate(copy.deepcopy(self.plan)), [])

    def test_repository_drift_is_rejected(self):
        plan = copy.deepcopy(self.plan)
        plan["implementation"]["repository"] = "Simple-Connection/sctool-registry"
        errors = self._validate(plan)
        self.assertIn("TASK_REPOSITORY:P1", errors)

    def test_version_drift_is_rejected(self):
        plan = copy.deepcopy(self.plan)
        plan["baseline"]["target_version"] = "1.0.4"
        errors = self._validate(plan)
        self.assertIn("TASK_VERSION_TO:P1", errors)

    def test_missing_task_requirement_is_rejected(self):
        plan = copy.deepcopy(self.plan)
        plan["work_units"][-1]["task_refs"].remove("completion.require:all_tests_pass")
        errors = self._validate(plan)
        self.assertIn(
            "TASK_REF_UNCOVERED:P1:completion.require:all_tests_pass",
            errors,
        )

    def test_source_task_hash_is_exact(self):
        raw = TASK_PATH.read_bytes()
        canonical = raw.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")
        expected = hashlib.sha256(canonical).hexdigest()
        digest = self.plan["source_task"]["digest"]
        self.assertEqual(digest["algorithm"], "SHA256")
        self.assertEqual(digest["canonicalization"], "UTF8_LF")
        self.assertEqual(digest["value"], expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
