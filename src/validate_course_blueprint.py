# -*- coding: utf-8 -*-
"""Validate a ChatGPT course_blueprint.json against the local schema."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCHEMA = ROOT / "src" / "schemas" / "course_blueprint.schema.json"


def _format_path(error_path: object) -> str:
    parts = [str(part) for part in error_path]
    return "$" if not parts else "$." + ".".join(parts)


def validate_blueprint(blueprint_path: Path, schema_path: Path = DEFAULT_SCHEMA) -> list[str]:
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    payload = json.loads(blueprint_path.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(payload), key=lambda item: list(item.path))
    return [f"{_format_path(error.path)}: {error.message}" for error in errors]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate a 视界专注 course_blueprint.json file.")
    parser.add_argument("blueprint", help="Path to course_blueprint.json")
    parser.add_argument("--schema", default=str(DEFAULT_SCHEMA), help="Path to course_blueprint.schema.json")
    args = parser.parse_args(argv)

    blueprint_path = Path(args.blueprint).resolve()
    schema_path = Path(args.schema).resolve()
    errors = validate_blueprint(blueprint_path, schema_path)
    if errors:
        print(f"course_blueprint validation failed: {len(errors)} issue(s)", file=sys.stderr)
        for error in errors[:40]:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"course_blueprint validation passed: {blueprint_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
