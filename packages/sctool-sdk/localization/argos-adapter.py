from __future__ import annotations

import argparse
import json
import sys
from typing import Any


def emit(payload: dict[str, Any], status: int) -> None:
    # ASCII-safe JSON prevents Windows console/code-page differences from
    # corrupting translated text when this adapter is used over a pipe.
    sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
    raise SystemExit(status)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Offline Argos Translate adapter for SCTool localization generation")
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:  # noqa: BLE001
        emit({"ok": False, "code": "ARGOS_INPUT_INVALID", "detail": str(exc)}, 2)

    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        emit({"ok": False, "code": "ARGOS_INPUT_INVALID", "detail": "items must be an array"}, 2)

    try:
        import argostranslate.translate as argos_translate
    except Exception as exc:  # noqa: BLE001
        emit(
            {
                "ok": False,
                "code": "ARGOS_NOT_INSTALLED",
                "detail": f"argostranslate import failed: {exc}",
            },
            3,
        )

    source = args.source.split("-", 1)[0].lower()
    target = args.target.split("-", 1)[0].lower()

    try:
        installed = argos_translate.get_installed_languages()
        source_language = next((language for language in installed if language.code.lower() == source), None)
        target_language = next((language for language in installed if language.code.lower() == target), None)
        if source_language is None or target_language is None:
            emit(
                {
                    "ok": False,
                    "code": "ARGOS_MODEL_MISSING",
                    "detail": f"installed Argos languages do not cover {source}->{target}",
                },
                4,
            )
        try:
            translation = source_language.get_translation(target_language)
        except Exception as exc:  # noqa: BLE001
            emit(
                {
                    "ok": False,
                    "code": "ARGOS_MODEL_MISSING",
                    "detail": f"no installed Argos translation path for {source}->{target}: {exc}",
                },
                4,
            )

        translations: dict[str, str] = {}
        for item in items:
            if not isinstance(item, dict):
                emit({"ok": False, "code": "ARGOS_INPUT_INVALID", "detail": "translation item must be an object"}, 2)
            key = item.get("key")
            text = item.get("text")
            if not isinstance(key, str) or not key or not isinstance(text, str):
                emit({"ok": False, "code": "ARGOS_INPUT_INVALID", "detail": "translation item requires string key/text"}, 2)
            translations[key] = translation.translate(text)
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        emit(
            {
                "ok": False,
                "code": "ARGOS_TRANSLATION_FAILED",
                "detail": str(exc),
            },
            5,
        )

    emit(
        {
            "ok": True,
            "source": args.source,
            "target": args.target,
            "translations": translations,
        },
        0,
    )


if __name__ == "__main__":
    main()
