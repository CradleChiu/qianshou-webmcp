#!/usr/bin/env python3
"""Extract one GTFS agency and its related records into a standalone feed."""

from __future__ import annotations

import argparse
import csv
import os
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from io import TextIOWrapper
from pathlib import Path
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile


Row = dict[str, str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    parser.add_argument("--agency-id", required=True)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


@contextmanager
def read_table(archive: ZipFile, name: str) -> Iterator[csv.DictReader]:
    try:
        entry = archive.open(name, "r")
    except KeyError as error:
        raise ValueError(f"Source GTFS is missing {name}.") from error
    with entry, TextIOWrapper(entry, encoding="utf-8-sig", newline="") as text:
        reader = csv.DictReader(text)
        if not reader.fieldnames:
            raise ValueError(f"{name} does not contain a header row.")
        yield reader


def write_rows(
    destination: ZipFile,
    name: str,
    fieldnames: list[str],
    rows: Iterable[Row],
) -> int:
    count = 0
    with destination.open(name, "w", force_zip64=True) as entry:
        with TextIOWrapper(entry, encoding="utf-8", newline="") as text:
            writer = csv.DictWriter(
                text,
                fieldnames=fieldnames,
                extrasaction="ignore",
                lineterminator="\n",
            )
            writer.writeheader()
            for row in rows:
                writer.writerow(row)
                count += 1
    return count


def filter_table(
    source: ZipFile,
    destination: ZipFile,
    name: str,
    predicate: Callable[[Row], bool],
    on_row: Callable[[Row], Any] | None = None,
) -> int:
    with read_table(source, name) as reader:
        fieldnames = list(reader.fieldnames or [])

        def selected_rows() -> Iterable[Row]:
            for row in reader:
                if predicate(row):
                    if on_row:
                        on_row(row)
                    yield row

        return write_rows(destination, name, fieldnames, selected_rows())


def optional_filter_table(
    source: ZipFile,
    destination: ZipFile,
    name: str,
    predicate: Callable[[Row], bool],
) -> int | None:
    if name not in source.namelist():
        return None
    return filter_table(source, destination, name, predicate)


def validate_existing(path: Path) -> None:
    required = {
        "agency.txt",
        "routes.txt",
        "stops.txt",
        "trips.txt",
        "stop_times.txt",
        "calendar_dates.txt",
    }
    with ZipFile(path, "r") as archive:
        missing = required.difference(archive.namelist())
        if missing:
            raise ValueError(
                f"Existing filtered GTFS is missing: {', '.join(sorted(missing))}"
            )
        bad_file = archive.testzip()
        if bad_file:
            raise ValueError(f"Existing filtered GTFS has a corrupt entry: {bad_file}")


def extract(source_path: Path, destination_path: Path, agency_id: str) -> None:
    partial_path = destination_path.with_name(f"{destination_path.name}.part")
    partial_path.unlink(missing_ok=True)
    counts: dict[str, int] = {}
    route_ids: set[str] = set()
    trip_ids: set[str] = set()
    service_ids: set[str] = set()
    shape_ids: set[str] = set()
    stop_ids: set[str] = set()

    try:
        with ZipFile(source_path, "r") as source:
            with ZipFile(
                partial_path,
                "w",
                compression=ZIP_DEFLATED,
                compresslevel=6,
                allowZip64=True,
            ) as destination:
                counts["agency.txt"] = filter_table(
                    source,
                    destination,
                    "agency.txt",
                    lambda row: row.get("agency_id") == agency_id,
                )
                counts["routes.txt"] = filter_table(
                    source,
                    destination,
                    "routes.txt",
                    lambda row: row.get("agency_id") == agency_id,
                    lambda row: route_ids.add(row["route_id"]),
                )
                counts["trips.txt"] = filter_table(
                    source,
                    destination,
                    "trips.txt",
                    lambda row: row.get("route_id") in route_ids,
                    lambda row: (
                        trip_ids.add(row["trip_id"]),
                        service_ids.add(row["service_id"]),
                        shape_ids.add(row["shape_id"])
                        if row.get("shape_id")
                        else None,
                    ),
                )
                counts["stop_times.txt"] = filter_table(
                    source,
                    destination,
                    "stop_times.txt",
                    lambda row: row.get("trip_id") in trip_ids,
                    lambda row: stop_ids.add(row["stop_id"]),
                )

                with read_table(source, "stops.txt") as reader:
                    fieldnames = list(reader.fieldnames or [])
                    all_stops = {
                        row["stop_id"]: row for row in reader if row.get("stop_id")
                    }
                pending = list(stop_ids)
                while pending:
                    stop = all_stops.get(pending.pop())
                    parent = stop.get("parent_station") if stop else None
                    if parent and parent not in stop_ids:
                        stop_ids.add(parent)
                        pending.append(parent)
                counts["stops.txt"] = write_rows(
                    destination,
                    "stops.txt",
                    fieldnames,
                    (
                        all_stops[stop_id]
                        for stop_id in sorted(stop_ids)
                        if stop_id in all_stops
                    ),
                )

                counts["calendar.txt"] = filter_table(
                    source,
                    destination,
                    "calendar.txt",
                    lambda row: row.get("service_id") in service_ids,
                )
                counts["calendar_dates.txt"] = filter_table(
                    source,
                    destination,
                    "calendar_dates.txt",
                    lambda row: row.get("service_id") in service_ids,
                )
                optional_counts = {
                    "frequencies.txt": optional_filter_table(
                        source,
                        destination,
                        "frequencies.txt",
                        lambda row: row.get("trip_id") in trip_ids,
                    ),
                    "shapes.txt": optional_filter_table(
                        source,
                        destination,
                        "shapes.txt",
                        lambda row: row.get("shape_id") in shape_ids,
                    ),
                }
                counts.update(
                    {
                        name: count
                        for name, count in optional_counts.items()
                        if count is not None
                    }
                )

        required_nonempty = [
            "agency.txt",
            "routes.txt",
            "stops.txt",
            "trips.txt",
            "stop_times.txt",
        ]
        empty = [name for name in required_nonempty if counts.get(name, 0) < 1]
        if empty:
            raise ValueError(
                f"Agency {agency_id} produced empty required tables: {', '.join(empty)}"
            )
        if counts.get("calendar.txt", 0) + counts.get("calendar_dates.txt", 0) < 1:
            raise ValueError(f"Agency {agency_id} has no service calendar records.")

        validate_existing(partial_path)
        os.replace(partial_path, destination_path)
    except Exception:
        partial_path.unlink(missing_ok=True)
        raise

    print(f"Created {destination_path.name} for agency {agency_id}")
    for name, count in counts.items():
        print(f"  {name}: {count:,} rows")


def main() -> None:
    args = parse_args()
    source_path = args.source.resolve()
    destination_path = args.destination.resolve()
    agency_id = args.agency_id.strip()
    if not source_path.is_file():
        raise FileNotFoundError(f"Source GTFS archive was not found: {source_path}")
    if not agency_id:
        raise ValueError("--agency-id cannot be empty.")
    if source_path == destination_path:
        raise ValueError("Source and destination GTFS archives must be different files.")
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    if destination_path.exists() and not args.force:
        validate_existing(destination_path)
        print(f"Keeping existing file: {destination_path.name}")
        return
    extract(source_path, destination_path, agency_id)


if __name__ == "__main__":
    main()
