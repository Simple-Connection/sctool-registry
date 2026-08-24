from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker, RefResolver

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "schemas"
FORMAT_CHECKER = FormatChecker()


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SystemExit(f"Invalid JSON {path}: {exc}") from exc


def validator(schema_name: str) -> Draft202012Validator:
    schema = load_json(SCHEMAS / schema_name)
    package_schema = load_json(SCHEMAS / "package.schema.json")
    publisher_schema = load_json(SCHEMAS / "publisher.schema.json")
    resolver = RefResolver.from_schema(
        schema,
        store={
            "package.schema.json": package_schema,
            "publisher.schema.json": publisher_schema,
        },
    )
    return Draft202012Validator(schema, resolver=resolver, format_checker=FORMAT_CHECKER)


def validate(schema_name: str, payload: Any, label: str) -> None:
    errors = sorted(validator(schema_name).iter_errors(payload), key=lambda err: list(err.absolute_path))
    if not errors:
        return
    rendered = []
    for err in errors:
        location = ".".join(str(part) for part in err.absolute_path) or "<root>"
        rendered.append(f"{label}:{location}: {err.message}")
    raise SystemExit("\n".join(rendered))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", default="_site")
    args = parser.parse_args()
    site = Path(args.site).resolve()

    trust = load_json(site / "trust.json")
    head = load_json(site / "registry-head.json")
    snapshot_path = head.get("signed", {}).get("snapshot", {}).get("path")
    if not isinstance(snapshot_path, str):
        raise SystemExit("registry-head.json does not contain signed.snapshot.path")
    snapshot = load_json(site / snapshot_path)

    validate("trust.schema.json", trust, "trust.json")
    validate("registry-head.schema.json", head, "registry-head.json")
    validate("registry-snapshot.schema.json", snapshot, snapshot_path)
    print(f"Pages JSON validation PASS snapshot={snapshot_path}")


if __name__ == "__main__":
    main()
