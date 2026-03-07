import subprocess
import time
import urllib.request

from openai import OpenAI
from rich import print

# ─── DEPENDENCY: llama.cpp server ────────────────────────────────────────────
# This class requires a llama-server process to be running locally.
# The server is bound to 127.0.0.1 only — NOT reachable from LAN or the public
# internet. Never bind to 0.0.0.0 on a public server.
#
# Start command:
#   ./llama.cpp/build/bin/llama-server \
#     --host 127.0.0.1 --port 8080 \
#     -m /path/to/classifier.gguf \
#     -ngl 99 -c 512
#
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_CLASSIFIER_SERVER = "http://127.0.0.1:8080"


OFF_TO_BUCKET = {
    # Condiments & Sauces
    'en:condiments': 'sauces spreads dips',
    'en:sauces': 'sauces spreads dips',
    'en:dips': 'sauces spreads dips',
    'en:vinegars': 'oils vinegars dressings',
    'en:ketchup': 'sauces spreads dips',
    'en:pestos': 'sauces spreads dips',
    'en:hot-sauces': 'sauces spreads dips',
    'en:soy-sauces': 'sauces spreads dips',

    # Oils and sweeteners
    'en:fats': 'oils vinegars dressings',
    'en:vegetable-oils': 'oils vinegars dressings',
    'en:syrups': 'sauces spreads dips',
    'en:agave-syrup': 'sauces spreads dips',
    'en:honey': 'sauces spreads dips',

    # Spreads
    'en:breakfasts': 'bread bakery pastries',
    'en:spreads': 'sauces spreads dips',
    'en:sweet-spreads': 'sauces spreads dips',
    'en:hazelnut-spreads': 'sauces spreads dips',
    'en:chocolate-spreads': 'sauces spreads dips',
    'en:cocoa-and-hazelnuts-spreads': 'sauces spreads dips',
    'fr:pates-a-tartiner': 'sauces spreads dips',

    # Snacks
    'en:snacks': 'snacks chips nuts',
    'en:salty-snacks': 'snacks chips nuts',
    'en:candies': 'snacks chips nuts',
    'en:confectioneries': 'snacks chips nuts',
    'en:chips-and-fries': 'snacks chips nuts',
    'en:potato-crisps': 'snacks chips nuts',

    # Dairy & Eggs
    'en:dairies': 'dairy eggs',
    'en:cheeses': 'dairy eggs',
    'en:fermented-milk-products': 'dairy eggs',
    'en:eggs': 'dairy eggs',

    # Meat & Fish
    'en:meats': 'meat poultry fish seafood',
    'en:prepared-meats': 'meat poultry fish seafood',
    'en:sausages': 'meat poultry fish seafood',
    'en:seafood': 'meat poultry fish seafood',
    'en:fishes': 'meat poultry fish seafood',
    'en:tunas': 'meat poultry fish seafood',

    # Fruit & Veg
    'en:fruits-and-vegetables-based-foods': 'fruit vegetables',
    'en:fruit-and-vegetable-preserves': 'fruit vegetables',
    'en:jams': 'fruit vegetables',
    'en:berry-jams': 'fruit vegetables',
    'en:apple-compotes': 'fruit vegetables',
    'en:fruit-compotes': 'fruit vegetables',
    'en:apples': 'fruit vegetables',
    'en:berries': 'fruit vegetables',
    'en:apricots': 'fruit vegetables',

    # Grains & Pasta
    'en:cereals-and-their-products': 'grains rice pasta legumes',
    'en:pastas': 'grains rice pasta legumes',
    'en:noodles': 'grains rice pasta legumes',
    'en:dry-pastas': 'grains rice pasta legumes',
    'en:rice': 'grains rice pasta legumes',
    'en:legumes': 'grains rice pasta legumes',

    # Drinks
    'en:beverages': 'drinks beverages',
    'en:plant-based-beverages': 'drinks beverages',
    'en:juices-and-nectars': 'drinks beverages',
    'en:soft-drinks': 'drinks beverages',
    'en:alcoholic-beverages': 'drinks beverages',

    # Spices & Seasoning
    'en:gewurze': 'spices herbs seasoning',
    'en:gewurzmittel': 'spices herbs seasoning',
    'en:curry-pastes': 'spices herbs seasoning',
    'en:herbs': 'spices herbs seasoning',
    'en:spices': 'spices herbs seasoning',
}


def _clean_output(raw: str, valid_labels: list[str]) -> str:
    """
    Strip any leading role tokens the model sometimes emits, then
    fuzzy-match against the known label list.

    Returns the matched label, or 'other' if nothing matches.
    """
    text = raw.strip()

    # Strip leading role token — happens when the assistant turn header
    # leaks into the generated tokens during batched left-padded inference.
    if text.lower().startswith("assistant"):
        text = text[len("assistant"):].lstrip("\n :").strip()

    text_lower = text.lower()

    # Exact match first
    for label in valid_labels:
        if text_lower == label.lower():
            return label

    # Substring match (model output contains the label somewhere)
    for label in valid_labels:
        if label.lower() in text_lower:
            return label

    # Fallback
    return "other"


class GroceryClassifier:
    def __init__(self, server_url: str = DEFAULT_CLASSIFIER_SERVER):
        self.tagging_classes = [
            'meat poultry fish seafood',
            'fruit vegetables',
            'bread bakery pastries',
            'grains rice pasta legumes',
            'oils vinegars dressings',
            'sauces spreads dips',
            'spices herbs seasoning',
            'baking ingredients',
            'snacks chips nuts',
            'drinks beverages',
            'frozen foods',
            'dairy eggs',
            'canned preserved foods',
            'household cleaning',
            'personal care hygiene',
            'other',
        ]

        self._system_prompt = (
            f"Classify the grocery item into exactly one of these categories: "
            f"{tuple(self.tagging_classes)}. "
            f"Reply with only the category name, nothing else."
        )

        print(f"[bold green]Classifier → llama.cpp server:[/bold green] {server_url}")
        self.client = OpenAI(base_url=f"{server_url}/v1", api_key="unused")
        self._model_id: str = ""
        self._server_url = server_url

        self.OFF_TO_BUCKET: dict = OFF_TO_BUCKET
        self._proc: subprocess.Popen | None = None

    # ── context manager ──────────────────────────────────────────────────────

    def __enter__(self) -> "GroceryClassifier":
        return self

    def __exit__(self, *_) -> None:
        self.stopServer()

    # ── server lifecycle ─────────────────────────────────────────────────────

    def classify(self, item: str, categories: list[str] = []) -> str:
        """Single-item classify — uses OFF_TO_BUCKET shortcut where possible."""
        for category in categories:
            if category in self.OFF_TO_BUCKET:
                return self.OFF_TO_BUCKET[category]
        return self.classifyMlBatch([item])[0]

    def classifyBatch(self, items: list[str], categories_list: list[list[str]] | None = None) -> list[str]:
        """
        Batch classify.

        items:           list of item name strings
        categories_list: optional parallel list of OFF category lists per item
                         (same length as items, or None to skip shortcut)
        """
        if categories_list is None:
            categories_list = [[] for _ in items]

        results: list[str] = [""] * len(items)
        ml_indices = []
        ml_items = []

        # Fast path: resolve OFF_TO_BUCKET hits without touching the model
        for i, (item, categories) in enumerate(zip(items, categories_list)):
            resolved = None
            for category in categories:
                if category in self.OFF_TO_BUCKET:
                    resolved = self.OFF_TO_BUCKET[category]
                    break
            if resolved is not None:
                results[i] = resolved
            else:
                ml_indices.append(i)
                ml_items.append(item)

        # ML path: batch everything that didn't resolve via lookup
        if ml_items:
            ml_results = self.classifyMlBatch(ml_items)
            for i, result in zip(ml_indices, ml_results):
                results[i] = result

        return results
    
    def startServer(
        self,
        model: str = "/app/other/models/LFM2.5-1.2B-Instruct-q4-class-mapping.gguf",
        port: int = 8080,
        timeout: int = 60,
    ) -> "GroceryClassifier":
        """Start the llama-server in the background and wait until it is ready."""
        self._proc = subprocess.Popen(
            [
                "llama-server",
                "-m", model,
                "--host", "127.0.0.1",
                "--port", str(port),
                "--ctx-size", "512",
                "--log-disable",
            ],
            #stdout=subprocess.DEVNULL,
            #stderr=subprocess.DEVNULL,
        )
        health_url = f"http://127.0.0.1:{port}/health"
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(health_url, timeout=2) as r:
                    if r.status == 200:
                        print(f"[bold green]Classifier server ready on port {port}[/bold green]")
                        models = self.client.models.list().data
                        if not models:
                            self._proc.terminate()
                            self._proc = None
                            raise RuntimeError("llama-server has no model loaded.")
                        self._model_id = models[0].id
                        print(f"[bold green]Classifier → model:[/bold green] {self._model_id}")
                        return self
            except Exception:
                pass
            time.sleep(1)
        self._proc.terminate()
        self._proc = None
        raise RuntimeError(f"llama-server did not become ready within {timeout}s")

    def stopServer(self) -> None:
        """Terminate the managed llama-server process and free its memory."""
        if self._proc is not None and self._proc.poll() is None:
            self._proc.terminate()
            self._proc.wait()
            print("[bold yellow]Classifier server stopped.[/bold yellow]")
        self._proc = None
        return None

    def classifyMlBatch(self, items: list[str]) -> list[str]:
        results = []
        for item in items:
            response = self.client.chat.completions.create(
                model=self._model_id,
                messages=[
                    {"role": "system", "content": self._system_prompt},
                    {"role": "user", "content": item},
                ],
                max_tokens=20,
                temperature=0.0,
            )
            raw = response.choices[0].message.content or ""
            results.append(_clean_output(raw, self.tagging_classes))
        return results


if __name__ == "__main__":
    import time

    items = [
        "himbeer marmelade", "blütenhonig", "birnen", "french toast",
        "vollmilch", "cheddar käse", "joghurt natur", "butter",
        "hühnerbrust", "lachs filet", "rinderhackfleisch",
        "spaghetti", "basmati reis", "haferflocken",
        "olivenöl", "sonnenblumenöl",
        "coca cola", "orangensaft", "grüner tee",
        "schokoladentafel", "gummibärchen", "vanilleeis",
        "kartoffelchips", "popcorn",
        "dosentomaten", "kichererbsen dose", "mais konserve",
        "tiefkühl pizza", "gefrorene erbsen",
        "waschmittel", "zahnpasta",
    ]

    with GroceryClassifier().startServer() as g:
        # --- Single item benchmark ---
        start = time.perf_counter()
        single = g.classify(item=items[0], categories=[])
        single_time = time.perf_counter() - start
        print(f"\n[bold]Single item:[/bold] '{items[0]}' → {single}  ({single_time:.2f}s)")

        # --- Batch benchmark ---
        start = time.perf_counter()
        results = g.classifyBatch(items)
        batch_time = time.perf_counter() - start

        print(f"\n[bold]Batch results ({len(items)} items in {batch_time:.2f}s, {batch_time/len(items)*1000:.0f}ms/item):[/bold]")
        for item, label in zip(items, results):
            print(f"  {item:<35} → {label}")
    # server is terminated here automatically