"""Automated static analysis and quality gate for PricePulse backend."""

from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

ROOT: Path = Path(__file__).resolve().parent.parent
MAX_LINE_LENGTH: int = 100


def check_line_lengths(paths: list[Path]) -> list[str]:
    """Verify all Python files adhere to <= 100 chars per line."""
    errors: list[str] = []
    for path in paths:
        for idx, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if len(line) > MAX_LINE_LENGTH:
                errors.append(
                    f"{path.relative_to(ROOT)}:{idx}: line length {len(line)} > {MAX_LINE_LENGTH}"
                )
    return errors


def _has_full_annotations(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    """Return missing parameter or return annotation descriptions for a function."""
    missing: list[str] = []
    if node.returns is None:
        missing.append("return type")
    all_args = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
    for arg in all_args:
        if arg.arg in ("self", "cls"):
            continue
        if arg.annotation is None:
            missing.append(f"arg '{arg.arg}'")
    if node.args.vararg and node.args.vararg.annotation is None:
        missing.append(f"*{node.args.vararg.arg}")
    if node.args.kwarg and node.args.kwarg.annotation is None:
        missing.append(f"**{node.args.kwarg.arg}")
    return missing


def check_type_annotations(paths: list[Path]) -> list[str]:
    """Verify 100% type annotation coverage on public functions/methods in src/ and tests/."""
    errors: list[str] = []
    for path in paths:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name.startswith("_") and node.name != "__init__":
                    continue
                missing = _has_full_annotations(node)
                if missing:
                    rel = path.relative_to(ROOT)
                    errors.append(
                        f"{rel}:{node.lineno}: '{node.name}' missing {', '.join(missing)}"
                    )
    return errors


def run_tool(args: list[str]) -> int:
    """Run a CLI tool inside the active Python environment."""
    print(f"Running: {' '.join(args)}")
    proc = subprocess.run(args, cwd=ROOT, check=False)
    return proc.returncode


def main() -> int:
    """Execute all static quality gates."""
    py_files = sorted(
        [
            *ROOT.joinpath("src").rglob("*.py"),
            *ROOT.joinpath("tests").rglob("*.py"),
            *ROOT.joinpath("scripts").rglob("*.py"),
        ]
    )
    errors = [*check_line_lengths(py_files), *check_type_annotations(py_files)]
    if errors:
        for err in errors:
            print(f"ERROR: {err}")
        return 1

    if run_tool([sys.executable, "-m", "ruff", "check", "src", "tests", "scripts"]) != 0:
        return 1
    if run_tool([sys.executable, "-m", "mypy", "src"]) != 0:
        return 1
    if run_tool([sys.executable, "-m", "pytest", "-v"]) != 0:
        return 1

    print("All quality gates passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

