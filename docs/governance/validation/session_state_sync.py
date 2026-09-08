from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Callable
import os

import yaml

from .state import derive_session_state


@dataclass(frozen=True)
class SessionStateSyncChange:
    session_id: str
    derived_state: str
    old_plan_state: str
    new_plan_state: str
    old_index_state: str | None
    new_index_state: str | None


def synchronize_session_states(
    plan: dict[str, Any],
    index: dict[str, Any],
    state_rules: dict[str, Any],
    load_session: Callable[[str], dict[str, Any]],
) -> list[SessionStateSyncChange]:
    version = plan["version"]["distribution_contract_version"]
    index_entries = {
        entry["id"]: entry
        for entry in index["versions"][version].get("sessions", [])
        if isinstance(entry, dict) and isinstance(entry.get("id"), str)
    }
    canonical = state_rules.get("canonical_plan_state_for_derived", {})
    plan_map = state_rules["plan_state_map"]
    changes: list[SessionStateSyncChange] = []

    for plan_session in plan.get("sessions", []):
        session_id = plan_session.get("id")
        document = plan_session.get("document")
        if not isinstance(session_id, str) or not isinstance(document, str):
            continue

        derived = derive_session_state(load_session(document), state_rules)
        old_plan = plan_session.get("state")
        if not isinstance(old_plan, str):
            continue
        if plan_map.get(old_plan) == derived:
            continue

        new_plan = canonical.get(derived)
        if not isinstance(new_plan, str):
            raise ValueError(f"SESSION_STATE_SYNC_UNMAPPED:{session_id}:{derived}")

        index_entry = index_entries.get(session_id)
        old_index = index_entry.get("state") if index_entry else None
        plan_session["state"] = new_plan
        if index_entry is not None:
            index_entry["state"] = new_plan

        current_next = index.get("current", {}).get("next_session")
        if isinstance(current_next, dict) and current_next.get("id") == session_id:
            current_next["state"] = new_plan

        plan_next = plan.get("next")
        if isinstance(plan_next, dict) and plan_next.get("session_id") == session_id:
            plan_next["state"] = new_plan

        changes.append(
            SessionStateSyncChange(
                session_id=session_id,
                derived_state=derived,
                old_plan_state=old_plan,
                new_plan_state=new_plan,
                old_index_state=old_index if isinstance(old_index, str) else None,
                new_index_state=new_plan if index_entry is not None else None,
            )
        )

    return changes


def _yaml_text(value: dict[str, Any]) -> str:
    return yaml.safe_dump(
        value,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
    )


def write_yaml_documents_atomically(
    root: Path,
    documents: dict[str, dict[str, Any]],
) -> None:
    originals: dict[str, str | None] = {}
    staged: dict[str, Path] = {}
    replaced: list[str] = []

    try:
        for rel, value in documents.items():
            target = root / rel
            originals[rel] = target.read_text(encoding="utf-8") if target.exists() else None
            target.parent.mkdir(parents=True, exist_ok=True)
            with NamedTemporaryFile(
                "w",
                encoding="utf-8",
                dir=target.parent,
                delete=False,
                newline="\n",
            ) as handle:
                handle.write(_yaml_text(value))
                handle.flush()
                os.fsync(handle.fileno())
                staged[rel] = Path(handle.name)

        for rel, temp in staged.items():
            os.replace(temp, root / rel)
            replaced.append(rel)
    except Exception:
        for rel in reversed(replaced):
            target = root / rel
            original = originals.get(rel)
            if original is None:
                target.unlink(missing_ok=True)
                continue
            with NamedTemporaryFile(
                "w",
                encoding="utf-8",
                dir=target.parent,
                delete=False,
                newline="\n",
            ) as handle:
                handle.write(original)
                handle.flush()
                os.fsync(handle.fileno())
                restore = Path(handle.name)
            os.replace(restore, target)
        raise
    finally:
        for temp in staged.values():
            temp.unlink(missing_ok=True)
