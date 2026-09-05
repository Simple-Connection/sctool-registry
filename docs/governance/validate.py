#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from validation.common import ValidationError
from validation.context import load_context
from validation import interpretation, responsibility, routing, session


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--index", default="docs/index.yaml")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    errors: list[str] = []

    try:
        ctx = load_context(root, args.index)
    except (ValidationError, KeyError, TypeError) as exc:
        print(f"ERROR CONTEXT_LOAD:{exc}")
        return 2

    for validator in (
        routing.validate,
        responsibility.validate,
        interpretation.validate,
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
