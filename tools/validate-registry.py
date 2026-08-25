from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "schemas"
FORMAT_CHECKER = FormatChecker()


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SystemExit(f"Invalid JSON {path.relative_to(ROOT)}: {exc}") from exc


def validate(schema_name: str, payload: Any, label: str) -> None:
    schema = load_json(SCHEMAS / schema_name)
    validator = Draft202012Validator(schema, format_checker=FORMAT_CHECKER)
    errors = sorted(validator.iter_errors(payload), key=lambda err: list(err.absolute_path))
    if errors:
        rendered = []
        for err in errors:
            location = ".".join(str(part) for part in err.absolute_path) or "<root>"
            rendered.append(f"{label}:{location}: {err.message}")
        raise SystemExit("\n".join(rendered))


def main() -> None:
    for schema_path in sorted(SCHEMAS.glob("*.schema.json")):
        Draft202012Validator.check_schema(load_json(schema_path))

    registry = load_json(ROOT / "registry.json")
    validate("registry.schema.json", registry, "registry.json")

    policy = load_json(ROOT / "policy" / "registry-policy.json")
    validate("policy.schema.json", policy, "policy/registry-policy.json")

    for package_id, relative_path in sorted(registry["packages"].items()):
        path = ROOT / relative_path
        payload = load_json(path)
        validate("package.schema.json", payload, relative_path)
        if payload.get("id") != package_id:
            raise SystemExit(f"Package identity mismatch: registry key {package_id!r} != descriptor id {payload.get('id')!r}")

    for publisher_id, relative_path in sorted(registry["publishers"].items()):
        path = ROOT / relative_path
        payload = load_json(path)
        validate("publisher.schema.json", payload, relative_path)
        if payload.get("id") != publisher_id:
            raise SystemExit(f"Publisher identity mismatch: registry key {publisher_id!r} != descriptor id {payload.get('id')!r}")

    trust_path = ROOT / "trust" / "trust.json"
    if trust_path.is_file():
        validate("trust.schema.json", load_json(trust_path), "trust/trust.json")

    print(
        "Registry JSON validation PASS "
        f"packages={len(registry['packages'])} publishers={len(registry['publishers'])} "
        f"trust={'active' if trust_path.is_file() else 'inactive'}"
    )


if __name__ == "__main__":
    main()
