from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .common import load_yaml


@dataclass(frozen=True)
class ValidationContext:
    root: Path
    index_path: str
    index: dict[str, Any]
    plan_path: str
    plan: dict[str, Any]
    rules_index_path: str
    rules_index: dict[str, Any]
    state_rules_path: str
    state_rules: dict[str, Any]
    staged_artifact_lifecycle: dict[str, Any]
    update_candidate_contract: dict[str, Any]
    template_index_path: str
    template_index: dict[str, Any]
    responsibility_index_path: str
    responsibility_index: dict[str, Any]
    authorities: dict[str, Any]
    vocabulary: dict[str, Any]
    contracts: dict[str, Any]
    responsibilities: dict[str, Any]
    descriptions: dict[str, Any]
    rationale: dict[str, Any]
    gate_registry: dict[str, Any]

    def load(self, rel: str) -> dict[str, Any]:
        return load_yaml(self.root, rel)


def load_context(root: Path, index_path: str) -> ValidationContext:
    index = load_yaml(root, index_path)
    plan_path = index["current"]["improvement_plan"]
    plan = load_yaml(root, plan_path)

    rules_index_path = index["rules_index"]
    rules_index = load_yaml(root, rules_index_path)
    state_rules_path = rules_index["routes"]["session_state"]
    state_rules = load_yaml(root, state_rules_path)
    staged_artifact_lifecycle = load_yaml(root, rules_index["routes"]["staged_artifact_lifecycle"])
    update_candidate_contract = load_yaml(root, rules_index["routes"]["update_candidate"])

    template_index_path = index["template_index"]
    template_index = load_yaml(root, template_index_path)

    responsibility_index_path = index["responsibility_index"]
    responsibility_index = load_yaml(root, responsibility_index_path)
    routes = responsibility_index["routes"]

    return ValidationContext(
        root=root,
        index_path=index_path,
        index=index,
        plan_path=plan_path,
        plan=plan,
        rules_index_path=rules_index_path,
        rules_index=rules_index,
        state_rules_path=state_rules_path,
        state_rules=state_rules,
        staged_artifact_lifecycle=staged_artifact_lifecycle,
        update_candidate_contract=update_candidate_contract,
        template_index_path=template_index_path,
        template_index=template_index,
        responsibility_index_path=responsibility_index_path,
        responsibility_index=responsibility_index,
        authorities=load_yaml(root, routes["authorities"]),
        vocabulary=load_yaml(root, routes["vocabulary"]),
        contracts=load_yaml(root, routes["contracts"]),
        responsibilities=load_yaml(root, routes["responsibilities"]),
        descriptions=load_yaml(root, routes["descriptions"]),
        rationale=load_yaml(root, routes["rationale"]),
        gate_registry=load_yaml(root, routes["gates"]),
    )
