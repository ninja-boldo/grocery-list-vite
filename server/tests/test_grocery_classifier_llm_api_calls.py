import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

# Ensure imports work when running from project root or from this folder.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
SERVER_ROOT = PROJECT_ROOT / "server"

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from transcript_classify.groceryClassifier.groceryClassifierLlm import (  # noqa: E402
    GroceryClassifierLlm,
)
from transcript_classify.groceryClassifier.lookups import (  # noqa: E402
    Category_Batch_TMPL,
    SHORTEN_BATCH_TMPL,
    WISH_Batch_TMPL,
    response_format_classify_item,
    response_format_map_wish_list,
    response_format_shorten_names_batch,
)
from utils.types import Item  # noqa: E402


def _make_classifier() -> GroceryClassifierLlm:
    with patch(
        "transcript_classify.groceryClassifier.groceryClassifierLlm.Groq"
    ) as groq_cls:
        groq_cls.return_value = MagicMock()
        return GroceryClassifierLlm(model="unit-test-model")


def _mock_response(content: str | None) -> Any:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )


class TestGroceryClassifierLlmApiCalls(unittest.TestCase):
    def test_invoke_calls_groq_and_parses_json(self) -> None:
        clf = _make_classifier()
        clf._client.chat.completions.create.return_value = _mock_response(
            '{"ok": true, "n": 2}'
        )

        out = clf._invoke(
            {"system": "sys", "user": "Items: {items_list}"},
            {"type": "json_schema"},
            {"items_list": ["milk", "eggs"]},
        )

        self.assertEqual(out, {"ok": True, "n": 2})
        clf._client.chat.completions.create.assert_called_once()
        called = clf._client.chat.completions.create.call_args.kwargs
        self.assertEqual(called["model"], "unit-test-model")
        self.assertEqual(called["messages"][0]["role"], "system")
        self.assertIn("Items:", called["messages"][1]["content"])

    def test_invoke_raises_on_empty_content(self) -> None:
        clf = _make_classifier()
        clf._client.chat.completions.create.return_value = _mock_response(None)

        with self.assertRaises(ValueError):
            clf._invoke(
                {"system": "sys", "user": "Text: {text}"},
                {"type": "json_schema"},
                {"text": "test"},
            )

    def test_parse_json_content_accepts_fenced_json(self) -> None:
        out = GroceryClassifierLlm._parse_json_content(
            """```json
{"mapped_wish": "milk"}
```"""
        )
        self.assertEqual(out, {"mapped_wish": "milk"})

    def test_classify_categories_batch_uses_api_call_contract(self) -> None:
        clf = _make_classifier()
        items = ["bio milch", "chips paprika"]
        classes = ["dairy eggs", "snacks chips nuts", "other"]

        with patch.object(
            clf,
            "_invoke",
            return_value={
                "bio milch": "dairy eggs",
                "chips paprika": "not-in-classes",
            },
        ) as mock_invoke:
            out = clf.classify_categories_batch(items, classes)

        self.assertEqual(
            out,
            {
                "bio milch": "dairy eggs",
                "chips paprika": "other",
            },
        )
        mock_invoke.assert_called_once_with(
            Category_Batch_TMPL,
            response_format_classify_item,
            {"items_list": items, "classes_list": classes},
        )

    def test_classify_categories_batch_accepts_nested_items_shape(self) -> None:
        clf = _make_classifier()

        with patch.object(
            clf,
            "_invoke",
            return_value={"items": {"apple": "fruit vegetables"}},
        ):
            out = clf.classify_categories_batch(
                ["apple", "soap"], ["fruit vegetables", "household cleaning", "other"]
            )

        self.assertEqual(out["apple"], "fruit vegetables")
        self.assertEqual(out["soap"], "other")

    def test_shorten_text_batch_uses_api_call_contract(self) -> None:
        clf = _make_classifier()
        items = ["Bio Joghurt 500g", "Coucous Extra"]
        categories = ["dairy eggs", "grains rice pasta legumes"]

        with patch.object(
            clf,
            "_invoke",
            return_value={
                "items": {"Bio Joghurt 500g": "Joghurt", "Coucous Extra": "Couscous"}
            },
        ) as mock_invoke:
            out = clf.shorten_text_batch(items, categories)

        self.assertEqual(
            out,
            {
                "Bio Joghurt 500g": "Joghurt",
                "Coucous Extra": "Couscous",
            },
        )
        mock_invoke.assert_called_once_with(
            SHORTEN_BATCH_TMPL,
            response_format_shorten_names_batch,
            {"items_list": items, "category_list": categories},
        )

    def test_shorten_text_batch_returns_none_on_invoke_error(self) -> None:
        clf = _make_classifier()

        with patch.object(clf, "_invoke", side_effect=RuntimeError("boom")):
            out = clf.shorten_text_batch(["milk"])

        self.assertIsNone(out)

    def test_map_wish_to_item_batch_uses_api_call_contract_and_parses_legacy_key(
        self,
    ) -> None:
        clf = _make_classifier()
        items = [
            Item(item_name="joghurt fettarm", info="from-a", count=2),
            Item(item_name="wasser still", info="from-b", count=1),
        ]
        wish_lists = [["joghurt", "milch", "other"], ["saft", "other"]]

        # 1st entry uses new key; 2nd entry uses legacy key and invalid mapped_wish.
        fake_out = {
            "joghurt fettarm": {"mapped_wish": "joghurt", "index_wish_list": 0},
            "wasser still": {"mapped_wish": "wasser", "wish_list_index": "9"},
        }

        with patch.object(clf, "_invoke", return_value=fake_out) as mock_invoke:
            out = clf.mapWishToItemBatch(items, wish_lists)

        self.assertIn("items", out)
        self.assertIn("wish_list_to_idx", out)
        self.assertEqual(out["items"]["joghurt fettarm"]["mapped_wish"], "joghurt")
        # Invalid mapped_wish falls back to "other" because it exists in wish_list.
        self.assertEqual(out["items"]["wasser still"]["mapped_wish"], "other")
        self.assertEqual(out["items"]["wasser still"]["index_wish_list"], 9)
        self.assertEqual(out["items"]["joghurt fettarm"]["info"]["count"], 2)

        payload = mock_invoke.call_args.args[2]
        self.assertIn("item_wish_dict", payload)
        self.assertEqual(mock_invoke.call_args.args[0], WISH_Batch_TMPL)
        self.assertEqual(mock_invoke.call_args.args[1], response_format_map_wish_list)

    def test_map_wish_to_item_batch_returns_fallback_on_error(self) -> None:
        clf = _make_classifier()
        items = ["apfelsaft"]
        wish_lists = [["saft", "other"]]

        with patch.object(clf, "_invoke", side_effect=RuntimeError("boom")):
            out = clf.mapWishToItemBatch(items, wish_lists)

        self.assertEqual(out["wish_list_to_idx"], {})
        self.assertEqual(out["items"]["apfelsaft"]["mapped_wish"], "null")
        self.assertEqual(out["items"]["apfelsaft"]["wish_list"], ["other", "saft"])
        self.assertIn("index_wish_list", out["items"]["apfelsaft"])

    def test_empty_inputs_do_not_call_api(self) -> None:
        clf = _make_classifier()

        with patch.object(
            clf, "_invoke", side_effect=AssertionError("must not be called")
        ):
            self.assertEqual(clf.classify_categories_batch([]), {})
            self.assertEqual(clf.shorten_text_batch([]), {})
            self.assertEqual(clf.mapWishToItemBatch([]), {})


# ---- Optional pretty TUI summary when executing this file directly ----


def _print_tui_summary(result: unittest.TestResult) -> None:
    total = result.testsRun
    failed = len(result.failures) + len(result.errors)
    skipped = len(result.skipped)
    passed = total - failed - skipped

    try:
        from rich.console import Console
        from rich.panel import Panel
        from rich.table import Table

        table = Table(show_header=True, header_style="bold cyan")
        table.add_column("Metric", justify="left")
        table.add_column("Count", justify="right")
        table.add_row("Passed", f"[green]{passed}[/green]")
        table.add_row("Failed", f"[red]{failed}[/red]")
        table.add_row("Skipped", f"[yellow]{skipped}[/yellow]")
        table.add_row("Total", f"[bold]{total}[/bold]")

        status = "PASS" if failed == 0 else "FAIL"
        border = "green" if failed == 0 else "red"
        title = f"GroceryClassifier LLM API Test Summary: {status}"

        Console().print(Panel.fit(table, title=title, border_style=border))
    except Exception:
        bar = "#" * max(1, passed)
        fail_bar = "!" * failed
        print("\n+-------------------------------------------+")
        print("| GroceryClassifier LLM API Test Summary    |")
        print("+-------------------------------------------+")
        print(f"| Passed : {passed:>3} {bar}")
        print(f"| Failed : {failed:>3} {fail_bar}")
        print(f"| Skipped: {skipped:>3}")
        print(f"| Total  : {total:>3}")
        print("+-------------------------------------------+\n")


class _TuiTextRunner(unittest.TextTestRunner):
    def run(self, test: unittest.suite.TestSuite) -> unittest.TestResult:
        result = super().run(test)
        _print_tui_summary(result)
        return result


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    _TuiTextRunner(verbosity=2).run(suite)
