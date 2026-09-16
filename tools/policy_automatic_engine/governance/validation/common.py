from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

import yaml

SAFE = re.compile(r"^[A-Za-z0-9_./:@{}*+<>|?=\-\[\]]+$")


class ValidationError(Exception):
    pass


def load_yaml(root: Path, rel: str) -> dict[str, Any]:
    path = root / rel
    if not path.is_file():
        raise ValidationError(f"MISSING_FILE:{rel}")
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValidationError(f"YAML_PARSE:{rel}:{exc}") from exc
    if not isinstance(value, dict):
        raise ValidationError(f"YAML_ROOT:{rel}")
    return value


def machine_safe(value: str) -> bool:
    return " " not in value and "\n" not in value and "\t" not in value and bool(SAFE.fullmatch(value))


def scan_machine(value: Any, path: str, errors: list[str]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or not machine_safe(key):
                errors.append(f"NATURAL_LANGUAGE_KEY:{path}:{key!r}")
            scan_machine(child, f"{path}.{key}", errors)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            scan_machine(child, f"{path}[{index}]", errors)
    elif isinstance(value, str) and not machine_safe(value):
        errors.append(f"NATURAL_LANGUAGE_VALUE:{path}:{value!r}")


def need(ok: bool, code: str, errors: list[str]) -> None:
    if not ok:
        errors.append(code)


def current_branch(root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
    except Exception:
        return None
    value = result.stdout.strip()
    return value or None
