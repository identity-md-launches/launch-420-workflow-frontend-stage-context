#!/usr/bin/env python3
"""Export (or verify) compiler ABI arrays from a completed local forge build."""

import argparse
import json
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if an exported ABI differs from the build")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    for name in ("LaunchToken", "Soapbox"):
        artifact = root / "out" / f"{name}.sol" / f"{name}.json"
        destination = root / "docs" / "abi" / f"{name}.json"
        if not artifact.is_file():
            sys.exit(f"Missing {artifact.relative_to(root)}; run forge build first.")
        abi = json.loads(artifact.read_text())["abi"]
        if args.check:
            if not destination.is_file() or json.loads(destination.read_text()) != abi:
                sys.exit(f"ABI mismatch: {destination.relative_to(root)}; run scripts/export_abi.py.")
            print(f"Verified {destination.relative_to(root)}")
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(json.dumps(abi, indent=2) + "\n")
            print(f"Exported {destination.relative_to(root)}")


if __name__ == "__main__":
    main()
