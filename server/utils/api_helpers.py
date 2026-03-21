import datetime
import json
from typing import Any, Optional


def convert_timestamps_to_dates(timestamps_json: str) -> list[str]:
    """Convert ISO timestamps to DD.MM.YYYY strings."""
    try:
        timestamps = json.loads(timestamps_json or "[]")
        return [
            datetime.datetime.fromisoformat(ts).date().strftime("%d.%m.%Y")
            for ts in timestamps
        ]
    except (json.JSONDecodeError, ValueError):
        return []


def safe_int(value: Any, default: int = 1) -> int:
    """Safely convert value to int."""
    try:
        return int(value) if value is not None else default
    except (ValueError, TypeError):
        return default


def sanitize_string(value: Optional[str], default: str = "") -> str:
    """Strip input or return default."""
    return (value or default).strip()


def validate_wish_list(value: Optional[str]) -> bool:
    """Normalize wish_list to 'true' or 'false'."""
    if not value:
        return False
    if value.strip().lower() == "true":
        return True
    return False
