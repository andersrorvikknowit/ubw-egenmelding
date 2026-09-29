#!/usr/bin/env python3
"""The two egenmelding day-cap rules, with test vectors.

Run:

    python3 tools/egenmelding_rules.py

The runner reports each vector as ok / FAIL and exits non-zero on any failure.
Standard library only.

Scope: the two day-cap rules plus case grouping. The 12-month quota, the
counting window, reading the UBW export and writing the CSVs are described in
`skills/ubw-egenmelding/SKILL.md` and are not part of this file.

`group_cases` splits an employee's dates into sykdomstilfeller (a new case every
16-day gap); the count of cases feeds the quota. The two `exceeds_*` functions
take an iterable of `datetime.date` and return

    (flagged: bool, evidence: list[date])

`evidence` is the breaching group, so a flag can be checked by hand. Return
`(False, [])` when nothing breaches. Input is sorted and de-duplicated
defensively, so callers need not pass distinct, ordered dates.
"""

import datetime as dt
import sys


# --- Rules -------------------------------------------------------------------


def group_cases(days):
    """Split egenmelding dates into sykdomstilfeller (sickness cases).

    A new case starts on any day that is 16 or more calendar days after the
    previous egenmelding day; a day less than 16 days later extends the current
    case. This is the case boundary the whole skill counts on: the number of
    cases is `sykdomstilfeller`, and the 4-per-12-months quota is measured over
    it. Returns a list of cases, each a sorted list of dates. Empty input gives
    `[]`.
    """
    dates = sorted(set(days))
    if not dates:
        return []
    cases = [[dates[0]]]
    for prev, day in zip(dates, dates[1:]):
        if (day - prev).days >= 16:
            cases.append([day])
        else:
            cases[-1].append(day)
    return cases


def exceeds_3_days_following(days):
    """Max 3 calendar days of egenmelding per sykdomstilfelle.

    Days count as calendar days from the first day of the case, so an
    unregistered weekend inside the span still counts (Fri, Mon = day 1..4 =
    breach). Return (True, evidence) for the offending case, else (False, []).
    """
    dates = sorted(set(days))
    flagged_dates_16 = []
    flagged_dates_3 = []
    for i in range(len(dates) - 1):
        flagged_dates_3.append(dates[i])
        flagged_dates_16.append(dates[i])
        for j in range(i + 1, len(dates), 1):
            if dates[i] + dt.timedelta(days=15) > dates[j]:
                flagged_dates_16.append(dates[j])
                if dates[i] + dt.timedelta(days=3) > dates[j]:
                    flagged_dates_3.append(dates[j])
                if len(flagged_dates_16) > 3 or len(flagged_dates_16) != len(
                    flagged_dates_3
                ):
                    return (True, flagged_dates_16)
            else:
                flagged_dates_16 = []
                flagged_dates_3 = []
        flagged_dates_16 = []
        flagged_dates_3 = []
    return (False, [])


def exceeds_3_days_16d_window(days):
    """No egenmelding within 16 calendar days of the last egenmelding day.

    After 3 days of egenmelding, work must resume and egenmelding cannot be used
    again until 16 calendar days have passed since the last egenmelding day. A
    date less than 16 days after the previous one extends the same case rather
    than starting a fresh one, so a 4th day inside that reach breaches.

    A window is a day plus the following 15 days, both ends included. Return
    (True, evidence) for a breaching window, else (False, []).
    """
    dates = sorted(set(days))
    flagged_dates_16 = []
    flagged_dates_3 = []
    for i in range(len(dates) - 1):
        flagged_dates_3.append(dates[i])
        flagged_dates_16.append(dates[i])
        for j in range(i + 1, len(dates), 1):
            if flagged_dates_16[-1] + dt.timedelta(days=15) >= dates[j]:
                flagged_dates_16.append(dates[j])
                if dates[i] + dt.timedelta(days=3) > dates[j]:
                    flagged_dates_3.append(dates[j])
                if len(flagged_dates_16) > 3 or len(flagged_dates_16) != len(
                    flagged_dates_3
                ):
                    return (True, flagged_dates_16)
            else:
                flagged_dates_16 = []
                flagged_dates_3 = []
                break
        flagged_dates_16 = []
        flagged_dates_3 = []
    return (False, [])


# --- Vectors -----------------------------------------------------------------


def d(text):
    return dt.date.fromisoformat(text)


# In August 2026: 10 Mon, 11 Tue, 12 Wed, 13 Thu, 14 Fri, 15 Sat, 16 Sun,
# 17 Mon, 18 Tue, 19 Wed, 20 Thu.
#
# (name, dates, expected) -- expected None means "you have to decide this one".
FOLLOWING_VECTORS = [
    (
        "3d-1 three consecutive weekdays",
        ["2026-08-17", "2026-08-18", "2026-08-19"],
        False,
    ),
    (
        "3d-2 four consecutive weekdays",
        ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"],
        True,
    ),
    ("3d-3 two isolated days 4 weeks apart", ["2026-08-17", "2026-09-15"], False),
    ("3d-4 a single day", ["2026-08-17"], False),
    ("3d-5 no days at all", [], False),
    (
        "3d-6 five consecutive weekdays",
        ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"],
        True,
    ),
    # Weekend cases: counting is by calendar days from the first day, and an
    # unregistered weekend continues the case rather than breaking it.
    (
        "3d-7 Friday then Monday, weekend not registered",
        ["2026-08-14", "2026-08-17"],
        True,
    ),
    ("3d-8 Friday, Sunday, Monday", ["2026-08-14", "2026-08-16", "2026-08-17"], True),
    (
        "3d-9 Saturday, Sunday, Monday",
        ["2026-08-15", "2026-08-16", "2026-08-17"],
        False,
    ),
    (
        "3d-10 Friday through Monday, whole weekend registered",
        ["2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17"],
        True,
    ),
    (
        "3d-11 Thursday then Monday, the Friday was worked",
        ["2026-08-13", "2026-08-17"],
        True,
    ),
]

SIXTEEN_DAY_VECTORS = [
    ("16d-1 only three days", ["2025-08-01", "2025-08-02", "2025-08-03"], False),
    (
        "16d-2 four days spread over 31 days -- a missing lower bound flags this",
        ["2025-08-01", "2025-08-02", "2025-08-03", "2025-09-01"],
        False,
    ),
    (
        "16d-3 fourth day exactly 15 days after the first",
        ["2025-08-01", "2025-08-05", "2025-08-10", "2025-08-16"],
        True,
    ),
    (
        "16d-4 fourth day 16 days after the first -- This is not legal",
        ["2025-08-01", "2025-08-05", "2025-08-10", "2025-08-17"],
        True,
    ),
    (
        "16d-5 breach is the late cluster -- a whole-set span test misses this, this is only a breach because of 4 consecutive days, not anything related to 16d.",
        [
            "2025-08-01",
            "2025-08-02",
            "2025-08-03",
            "2025-10-01",
            "2025-10-02",
            "2025-10-03",
            "2025-10-04",
        ],
        True,
    ),
    (
        "16d-6 four consecutive days",
        ["2025-08-01", "2025-08-02", "2025-08-03", "2025-08-04"],
        True,
    ),
]

# group_cases: (name, dates, expected number of cases)
CASE_VECTORS = [
    ("gc-1 no days", [], 0),
    ("gc-2 single day", ["2025-08-01"], 1),
    ("gc-3 three consecutive days = one case", ["2025-08-17", "2025-08-18", "2025-08-19"], 1),
    ("gc-4 gap of exactly 16 days splits", ["2025-08-01", "2025-08-17"], 2),
    ("gc-5 gap of 15 days stays one case", ["2025-08-01", "2025-08-16"], 1),
    (
        "gc-6 four spread-out illnesses",
        ["2025-08-28", "2025-10-07", "2025-12-11", "2026-02-12"],
        4,
    ),
    ("gc-7 unsorted input", ["2025-08-19", "2025-08-01", "2025-08-18"], 2),
]


# --- Runner ------------------------------------------------------------------


def run(label, function, vectors):
    failed = pending = undecided = 0

    for name, dates, expected in vectors:
        if expected is None:
            undecided += 1
            print("  [ -- ] {}  <- UNDECIDED, fill in the expected value".format(name))
            continue
        try:
            flagged, evidence = function([d(x) for x in dates])
        except NotImplementedError:
            pending += 1
            print("  [ .. ] {}".format(name))
            continue
        except Exception as error:  # noqa: BLE001
            failed += 1
            print(
                "  [FAIL] {}\n         raised {}: {}".format(
                    name, type(error).__name__, error
                )
            )
            continue

        if flagged != expected:
            failed += 1
            print(
                "  [FAIL] {}\n         expected {}, got {}".format(
                    name, expected, flagged
                )
            )
        elif flagged and not evidence:
            failed += 1
            print(
                "  [FAIL] {}\n         flagged, but returned no evidence".format(name)
            )
        else:
            print("  [ ok ] {}".format(name))

    return failed, pending, undecided


def run_cases(vectors):
    failed = 0
    for name, dates, expected in vectors:
        try:
            got = len(group_cases([d(x) for x in dates]))
        except Exception as error:  # noqa: BLE001
            failed += 1
            print(
                "  [FAIL] {}\n         raised {}: {}".format(
                    name, type(error).__name__, error
                )
            )
            continue
        if got != expected:
            failed += 1
            print("  [FAIL] {}\n         expected {} cases, got {}".format(name, expected, got))
        else:
            print("  [ ok ] {}".format(name))
    return failed, 0, 0


def main():
    print("3-following-days rule")
    a = run("following", exceeds_3_days_following, FOLLOWING_VECTORS)
    print("\n16-day window rule")
    b = run("16d", exceeds_3_days_16d_window, SIXTEEN_DAY_VECTORS)
    print("\ncase grouping")
    c = run_cases(CASE_VECTORS)

    failed, pending, undecided = (x + y + z for x, y, z in zip(a, b, c))
    total = len(FOLLOWING_VECTORS) + len(SIXTEEN_DAY_VECTORS) + len(CASE_VECTORS)
    passed = total - failed - pending - undecided

    print(
        "\n{} passed, {} failed, {} not implemented, {} undecided (of {})".format(
            passed, failed, pending, undecided, total
        )
    )

    if pending:
        print("\nImplement the functions marked TODO, then run this again.")
    if undecided:
        print(
            "Vectors marked UNDECIDED need an expected value before they test anything."
        )
    if failed or pending or undecided:
        return 1
    print("\nAll vectors pass.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
