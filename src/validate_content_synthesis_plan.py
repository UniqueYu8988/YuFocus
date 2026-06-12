# -*- coding: utf-8 -*-
"""Legacy JSON syntax checker for retired deep-synthesis plan files.

The old staged content synthesis schemas are no longer part of the default
production path. This helper remains so older notes can be opened during
manual inspection, but new software flows do not call it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

def _format_path(error_path: object) -> str:
    parts = [str(part) for part in error_path]
    return "$" if not parts else "$." + ".".join(parts)


def validate_content_synthesis_plan(plan_path: Path, schema_path: Path | None = None) -> list[str]:
    payload = json.loads(plan_path.read_text(encoding="utf-8"))
    if schema_path is None:
        return [] if isinstance(payload, dict) else ["$: expected a JSON object"]
    if not schema_path.exists():
        return [f"$: schema not found: {schema_path}"]

    from jsonschema import Draft202012Validator

    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(payload), key=lambda item: list(item.path))
    return [f"{_format_path(error.path)}: {error.message}" for error in errors]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check a retired 视界专注 synthesis_plan.json file.")
    parser.add_argument("plan", help="Path to synthesis_plan.json")
    parser.add_argument("--schema", default="", help="Optional legacy schema path")
    args = parser.parse_args(argv)

    plan_path = Path(args.plan).resolve()
    schema_path = Path(args.schema).resolve() if args.schema else None
    errors = validate_content_synthesis_plan(plan_path, schema_path)
    if errors:
        print(f"synthesis_plan validation failed: {len(errors)} issue(s)", file=sys.stderr)
        for error in errors[:40]:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"synthesis_plan validation passed: {plan_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
