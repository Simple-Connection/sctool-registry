#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

GOVERNANCE_ROOT = Path(__file__).resolve().parent
if str(GOVERNANCE_ROOT) not in sys.path:
    sys.path.insert(0, str(GOVERNANCE_ROOT))

from validation.common import ValidationError
from validation.context import load_context
from validation.session_state_sync import (
    synchronize_next_session_projection,
    synchronize_session_states,
    write_yaml_documents_atomically,
)
from validation import artifact, distribution, install, interpretation, planning, responsibility, routing, session


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--index", default="docs/index.yaml")
    parser.add_argument(
        "--sync-session-states",
        action="store_true",
        help=(
            "Synchronize derived machine-session state and the canonical next-session projection "
            "into the improvement plan and docs index before validation."
        ),
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    errors: list[str] = []

    try:
        ctx = load_context(root, args.index)
    except (ValidationError, KeyError, TypeError) as exc:
        print(f"ERROR CONTEXT_LOAD:{exc}")
        return 2

    if args.sync_session_states:
        try:
            changes = synchronize_session_states(
                ctx.plan,
                ctx.index,
                ctx.state_rules,
                ctx.load,
            )
            projection_change = synchronize_next_session_projection(ctx.plan, ctx.index)
            if changes or projection_change is not None:
                write_yaml_documents_atomically(
                    root,
                    {
                        ctx.plan_path: ctx.plan,
                        ctx.index_path: ctx.index,
                    },
                )
                for change in changes:
                    print(
                        "SYNC SESSION_STATE "
                        f"{change.session_id} "
                        f"{change.old_plan_state}->{change.new_plan_state} "
                        f"derived={change.derived_state}"
                    )
                if projection_change is not None:
                    old_id = (
                        projection_change.old_projection.get("id")
                        if projection_change.old_projection is not None
                        else None
                    )
                    new_id = (
                        projection_change.new_projection.get("id")
                        if projection_change.new_projection is not None
                        else None
                    )
                    print(f"SYNC NEXT_SESSION_PROJECTION {old_id}->{new_id}")
                ctx = load_context(root, args.index)
            else:
                print("SYNC SESSION_STATE no_changes")
                print("SYNC NEXT_SESSION_PROJECTION no_changes")
        except (ValidationError, KeyError, TypeError, ValueError, OSError) as exc:
            print(f"ERROR SESSION_STATE_SYNC:{exc}")
            return 2

    for validator in (
        routing.validate,
        responsibility.validate,
        interpretation.validate,
        artifact.validate,
        distribution.validate,
        install.validate,
        planning.validate,
        session.validate,
    ):
        validator(ctx, errors)

    if errors:
        for error in errors:
            print(f"ERROR {error}")
        print(f"Development governance validation FAIL errors={len(errors)}")
        return 1

    print(
        "Development governance validation PASS "
        f"versions={len(ctx.index['versions'])} "
        f"sessions={len(ctx.plan['sessions'])} "
        f"responsibilities={len(ctx.responsibilities['responsibilities'])} "
        f"rationales={len(ctx.rationale.get('rationales', {}))} "
        f"gates={len(ctx.gate_registry['gates'])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
