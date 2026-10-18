#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Single-term recall, gibberish abstention and no-token messaging."""

import re
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


# Generic words whose bypass previously let unrelated rows ride along.
RIDER_EXAMPLES = [
    ("product", "card"), ("product", "login"), ("product", "menu"),
    ("product", "fast"), ("style", "hover"), ("style", "modern"),
    ("style", "color"),
]
IDENTITY_FIELDS = ("Keywords", "Aliases", "Style ID", "Style Category")


def _whole_words(row):
    words = set()
    for field in IDENTITY_FIELDS:
        words.update(re.findall(r"[a-z0-9]+", str(row.get(field, "")).lower()))
    return words


class TestSingleTermRecall(unittest.TestCase):
    def test_bypass_returns_only_rows_containing_the_term(self):
        for domain, query in RIDER_EXAMPLES:
            with self.subTest(domain=domain, query=query):
                result = search(query, domain)
                for row in result["results"]:
                    self.assertIn(query, _whole_words(row), row)

    def test_stopword_only_query_reports_no_searchable_terms(self):
        result = search("the", "style", diagnostics=True)
        self.assertEqual(result["count"], 0)
        self.assertTrue(result.get("no_searchable_terms"), result)

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


class TestSearchDocstring(unittest.TestCase):
    def test_docstring_has_no_hardcoded_version(self):
        source = (SCRIPTS_DIR / "search.py").read_text(encoding="utf-8")
        docstring = source.split('"""', 2)[1]
        self.assertIsNone(re.search(r"\bv?\d+\.\d+\.\d+\b", docstring), docstring[:200])


if __name__ == "__main__":
    unittest.main()
