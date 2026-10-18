#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Single-term recall, gibberish abstention and no-token messaging."""

import subprocess
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

from core import CSV_CONFIG, search

# Every keyword below exists in the domain CSV's Keywords column.
EXACT_KEYWORD_PAIRS = [
    ("icons", "graph"),
    ("icons", "statistics"),
    ("icons", "chart"),
    ("icons", "dashboard"),
    ("landing", "dashboard"),
    ("react", "waterfall"),
    ("react", "memoize"),
    ("web", "accessibilitylabel"),
    ("gsap", "hover"),
    ("gsap", "parallax"),
]


class TestSingleTermRecall(unittest.TestCase):
    def test_exact_single_keyword_returns_row(self):
        for domain, query in EXACT_KEYWORD_PAIRS:
            with self.subTest(domain=domain, query=query):
                self.assertGreaterEqual(search(query, domain)["count"], 1)

    def test_gibberish_single_token_returns_nothing(self):
        for domain in CSV_CONFIG:
            with self.subTest(domain=domain):
                self.assertEqual(search("zzqxvkw", domain)["count"], 0)

    def test_query_without_indexable_tokens_says_so(self):
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "search.py"),
             "日本語 デザイン", "-d", "style"],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("No searchable terms in query", proc.stdout)


if __name__ == "__main__":
    unittest.main()
