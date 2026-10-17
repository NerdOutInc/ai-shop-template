"""Shared validation for hand-authored UTF-8 job and review records."""

import json
import math


def object_value(value, name):
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    return value


def read_object(path):
    return object_value(json.loads(path.read_text(encoding="utf-8")), path.name)


def list_value(value, name):
    if not isinstance(value, list):
        raise ValueError(f"{name} must be a list")
    return value


def finite_numbers(values, length, name):
    if not isinstance(values, list) or len(values) != length:
        raise ValueError(f"{name} must contain {length} numbers")
    if not all(isinstance(x, (float, int)) and not isinstance(x, bool) and math.isfinite(x) for x in values):
        raise ValueError(f"{name} must contain finite numbers")
    return values


def resolve_file(value, record_path, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Missing input path: {name}")
    path = (record_path.parent / value).resolve()
    if not path.is_file():
        raise ValueError(f"Missing input file: {name}")
    return path
