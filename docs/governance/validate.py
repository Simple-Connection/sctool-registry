#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from validation.common import ValidationError
from validation.context import load_context
from validation.session_state_sync import synchronize_session_states, write_yaml_documents_atomically
from validation import artifact, distribution, install, interpretation, planning, responsibility, routing, session


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--index", default="docs/index.yaml")
    parser.add_argument(
        "--sync-session-states",
        action="store_true",
        help="Synchronize derived machine-session state into the improvement plan and docs index before validation.",
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
            if changes:
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
                ctx = load_context(root, args.index)
            else:
                print("SYNC SESSION_STATE no_changes")
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
