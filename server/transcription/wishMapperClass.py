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
#     --host 127.0.0.1 --port 8081 \
#     -m /path/to/wish_mapper.gguf \
#     -ngl 99 -c 1024
#
# Install Python dependency:  pip install openai
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_WISH_MAPPER_SERVER = "http://127.0.0.1:8081"


class WishMapper:
    def __init__(self, server_url: str = DEFAULT_WISH_MAPPER_SERVER):
        self._system_prompt = (
            "Map the grocery item to the most similar item from the wish list. "
            "Reply with ONLY the exact wish list item name, or 'none' if no good match exists. "
            "Do not add explanations or extra text."
        )

        print(f"[bold green]WishMapper → llama.cpp server:[/bold green] {server_url}")
        self.client = OpenAI(base_url=f"{server_url}/v1", api_key="unused")
        self._model_id: str = ""
        self._proc: subprocess.Popen | None = None

    # ── context manager ──────────────────────────────────────────────────────

    def __enter__(self) -> "WishMapper":
        return self

    def __exit__(self, *_) -> None:
        self.stopServer()

    # ── server lifecycle ─────────────────────────────────────────────────────

    def startServer(
        self,
        model: str = "/app/other/models/Qwen3-VL-2B-Instruct-wish-mapping-q4_K_M.gguf",
        port: int = 8081,
        timeout: int = 60,
    ) -> "WishMapper":
        """Start the llama-server in the background and wait until it is ready."""
        self._proc = subprocess.Popen(
            [
                "llama-server",
                "-m", model,
                "--host", "127.0.0.1",
                "--port", str(port),
                "--ctx-size", "1024",
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
                        print(f"[bold green]WishMapper server ready on port {port}[/bold green]")
                        models = self.client.models.list().data
                        if not models:
                            self._proc.terminate()
                            self._proc = None
                            raise RuntimeError("llama-server has no model loaded.")
                        self._model_id = models[0].id
                        print(f"[bold green]WishMapper → model:[/bold green] {self._model_id}")
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
            print("[bold yellow]WishMapper server stopped.[/bold yellow]")
        self._proc = None

    def mapWishItem(self, item_name: str, wished_items: list[str]) -> str:
        """
        Map a single item to a wished item.
        Used by server for single-item mapping.
        
        Args:
            item_name: The grocery item name to map
            wished_items: List of wished item names to map to
            
        Returns:
            The mapped wish item name, or 'none' if no match
        """
        # Shortcut: exact match
        if item_name in wished_items:
            return item_name
        
        # ML path for single item
        batch_results = self._mapMlBatch([item_name], [wished_items])
        return batch_results[0]

    def map(self, item: str, wish_list: list[str] = []) -> str:
        """Alias for mapWishItem - backwards compatibility"""
        return self.mapWishItem(item, wish_list)

    def mapBatch(self, items: list[str], wish_lists: list[list[str]] | None = None) -> list[str]:
        """
        Batch mapping for multiple items.
        
        Args:
            items: List of item name strings
            wish_lists: Optional parallel list of wish lists per item
                       (same length as items, or None to use empty lists)
                       
        Returns:
            List of mapped wish item names
        """
        if wish_lists is None or len(wish_lists) == 0:
            wish_lists = [[] for _ in items]

        results: list[str] = [""] * len(items)
        ml_indices = []
        ml_items = []
        ml_wishes = []

        # Fast path: check for exact matches first
        for i, (item, wishes) in enumerate(zip(items, wish_lists)):
            if item in wishes:
                results[i] = item
            else:
                ml_indices.append(i)
                ml_items.append(item)
                ml_wishes.append(wishes)

        # ML path: batch everything that didn't resolve
        if ml_items:
            ml_results = self._mapMlBatch(ml_items, ml_wishes)
            for i, result in zip(ml_indices, ml_results):
                results[i] = result

        return results

    def _mapMlBatch(self, items: list[str], wish_lists: list[list[str]]) -> list[str]:
        """Internal method for ML-based batch mapping"""
        results = []
        for item, wish_list in zip(items, wish_lists):
            wish_str = ", ".join(wish_list) if wish_list else "none"
            response = self.client.chat.completions.create(
                model=self._model_id,
                messages=[
                    {"role": "system", "content": self._system_prompt},
                    {"role": "user", "content": f"item: {item}\nwish_list: {wish_str}"},
                ],
                max_tokens=20,
                temperature=0.0,
            )
            results.append((response.choices[0].message.content or "").strip())
        return results


if __name__ == "__main__":
    import time

    wished_items = [
        "marmelade", "honig", "obst", "toast",
        "milch", "käse", "joghurt", "butter",
        "fleisch", "fisch",
        "nudeln", "reis", "haferflocken",
        "öl",
        "getränke", "saft", "tee",
        "süßigkeiten", "eis",
        "snacks",
        "konserven",
        "tiefkühl",
        "haushalt",
    ]

    items = [
        # ── items expected to match ────────────────────────────────────────
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

        # ── hard Open Food Facts style items (should still map) ───────────
        # brand / product-name noise
        "Barilla Spaghetti n°5 500g",
        "Alpro Soja Cuisine zum Kochen 250ml",
        "Ja! Vollmilch 3,5% Fett 1L",
        "Schwartau Extra Erdbeere Konfitüre 340g",
        "Philadelphia Doppelrahmstufe Frischkäse Natur 175g",
        "Dr. Oetker Ristorante Pizza Mozzarella tiefgekühlt 355g",
        "Knorr Fix Spaghetti Bolognese Würzmischung 57g",
        "Milka Alpenmilch Schokolade 270g",
        "Haribo Goldbären 200g",
        "Langnese Cremissimo Vanille 500ml",
        "Pringles Original 185g",
        "Heinz Beefsteak Tomaten gehackt 400g",
        "Bonduelle Mais natur 285g Abtropfgewicht",
        "Rama mit Butter Brotaufstrich 500g",
        "Twinings English Breakfast Tea 25 Beutel",
        "Bertolli Classico Olivenöl 750ml",
        "Uncle Ben's Basmati & Wild Reis Mikrowelle 250g",
        "Gut&Günstig Naturjoghurt 3,5% 500g",
        "Edeka Bio Hähnchenbrust ohne Haut 400g",
        "Iglo Spinat gehackt tiefgefroren 750g",
        # ── more stress tests for marmelade-fallback failure ──────────────
        # obst (fruit — frequently confused with marmelade)
        "Chiquita Bananen 1kg",
        "Pink Lady Äpfel 6er Netz",
        "Edeka Bio Erdbeeren 500g",
        "Sanguinello Blutorangen 1,5kg Netz",
        "Dole Ananas in Scheiben 580g",
        # eis (ice cream — confused with marmelade)
        "Ben & Jerry's Cookie Dough 465ml",
        "Häagen-Dazs Strawberry 460ml",
        "Mövenpick Macadamia Nut 900ml",
        "Magnum Classic 3er Multipack",
        "Dr. Oetker Baked in Tub Schokolade 900ml",
        # tiefkühl (frozen — confused with marmelade)
        "McCain Backofen Pommes 750g",
        "Iglo Fischstäbchen 10 Stück 280g",
        "Birds Eye Garden Peas 900g tiefgefroren",
        "Edeka Bio Blattspinat tiefgekühlt 450g",
        "Frosta Lachs in Dillsauce 380g gefroren",
        # konserven (canned — confused with marmelade)
        "Mutti Polpa Tomatenstücke 400g",
        "Hengstenberg Sauerkraut 810g Dose",
        "Peso Thunfisch in eigenem Saft 185g",
        "Bonduelle Grüne Bohnen geschnitten 400g",
        "Rio Mare Thunfisch-Salat Mais 160g",

        # ── items NOT in wish list (expect 'none') ────────────────────────
        "Aspirin 500mg Tabletten 20 Stück",
        "Pampers Baby-Dry Windeln Größe 4",
        "Penaten Pflegecreme 150ml",
        "Schauma Shampoo Kamille 400ml",
        "Nivea Men Rasierschaum sensitive 200ml",
        "Tempo Taschentücher 10x9 Tücher",
        "Schweppes Tonic Water 1L",
        "Red Bull Energy Drink 250ml",
        "Jack Daniel's Tennessee Whiskey 700ml",
        "Becks Pils 6x0,5L Kasten",
        "Edding 3000 Permanent-Marker schwarz",
        "Post-it Haftnotizen 76x76mm gelb",
        "Duracell Plus AA Batterien 4er Pack",
        "Finish Quantum All-in-1 Spülmaschinentabs 60 Stück",
        "Ariel Flüssig Vollwaschmittel 1,98L",
        "WC Ente Active Gel ozean frisch 750ml",
    ]

    with WishMapper().startServer() as mapper:
        # --- Single item benchmark (server usage pattern) ---
        start = time.perf_counter()
        single = mapper.mapWishItem(items[0], wished_items)
        single_time = time.perf_counter() - start
        print(f"\n[bold]Single item:[/bold] '{items[0]}' → {single}  ({single_time:.2f}s)")

        # --- Batch benchmark ---
        start = time.perf_counter()
        wish_lists = [wished_items] * len(items)  # same wish list for all items
        results = mapper.mapBatch(items, wish_lists)
        batch_time = time.perf_counter() - start

        print(f"\n[bold]Batch results ({len(items)} items in {batch_time:.2f}s, {batch_time/len(items)*1000:.0f}ms/item):[/bold]")
        for item, mapped in zip(items, results):
            print(f"  {item:<35} → {mapped}")
    # server is terminated here automatically