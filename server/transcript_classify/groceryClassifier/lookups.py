# lookups.py – Single source of truth for all static data, normalization helpers,
# pre-computed lookup tables, and LLM prompt templates.

import re
import unicodedata

# ─── Category descriptions (bi-encoder passage embeddings) ───────────────────

CLASS_DESCRIPTIONS: dict[str, str] = {
    "fruit vegetables": (
        "Obst und Gemüse: frisches Obst, Gemüse, Kräuter, Salat, Pilze, Knoblauch, "
        "Zwiebeln, Kartoffeln, Möhren, Karotten, Avocado, Beeren, Äpfel, Bananen, "
        "Tomaten, Gurken, Paprika frisch, Zucchini, Brokkoli, Spinat, Champignons, "
        "Honigmelone, Wassermelone, Melone, honey melon, watermelon, "
        "légumes frais, fruits frais, verduras frescas, frutas frescas, "
        "zanahorias, aguacate, tomates, pepino"
    ),
    "dairy eggs": (
        "Milchprodukte und Eier: Joghurt, Käse, Butter, Milch, milk, Quark, "
        "Frischkäse, cream cheese, Jben, fromage frais, Eier, Sahne, Skyr, "
        "Mozzarella, Hafermilch, Mandelmilch, Sojamilch, Alpro, "
        "pflanzliche Milchalternativen, lait, beurre, œufs, fromage, "
        "crème, leche, yogur, huevos"
    ),
    "bread bakery pastries": (
        "Brot, Backwaren und Gebäck: Brot, Brötchen, Kuchen, Toast, Croissant, "
        "Baguette, Vollkornbrot, Roggenbrot, Laugengebäck, Muffins, pain, "
        "viennoiserie, pan integral, pan de mie, pan rebanado"
    ),
    "snacks chips nuts": (
        "Snacks, Chips, Nüsse und Süßigkeiten: Schokolade, Milka, Ritter Sport, "
        "Excellence Noir, dunkle Schokolade, Bitterschokolade, Kakaoschokolade, "
        "Gummibären, Haribo, Chips, Crunchips, Kekse, Popcorn, Riegel, "
        "Proteinriegel, Erdnüsse, Mandeln, Walnüsse, Müsliriegel, Bonbons, "
        "Patatas fritas, crisps, chocolat noir, chocolat au lait, biscuits, noix, "
        "patatas fritas sabor, snacks salados, pâte de cacao"
    ),
    "meat poultry fish seafood": (
        "Fleisch, Geflügel, Fisch und Meeresfrüchte: Hähnchen, Rind, Schwein, "
        "Lachs, Thunfisch, Garnelen, Aufschnitt, Wurst, Salami, Schinken, "
        "Fischfilet, viande, poulet, poisson, jambon, pollo, atún, atun, "
        "pollo troceado, filet de poulet"
    ),
    "grains rice pasta legumes": (
        "Getreide, Reis, Nudeln und Hülsenfrüchte: Spaghetti, Reis, Linsen, "
        "Kichererbsen, Haferflocken, Müsli, Quinoa, Couscous, Bulgur, Bohnen, "
        "Erbsen, pâtes, riz, légumineuses, arroz, lentejas, garbanzos"
    ),
    "canned preserved foods": (
        "Konserven und haltbare Lebensmittel in Dosen oder Gläsern: "
        "Dosentomaten, Thunfisch in Dose, Kichererbsen aus der Dose, "
        "Mais in Dose, Bohnen aus der Dose, Ravioli in Dose, Suppen, "
        "conserves, plats préparés en boîte, conservas en lata, "
        "thon en conserve, pois chiches en boîte"
    ),
    "sauces spreads dips": (
        "Saucen, Aufstriche und Dips: Senf, Ketchup, Mayonnaise, Marmelade, "
        "Konfitüre, Erdbeermarmelade, Aprikosenmarmelade, Pesto, Tapenade, "
        "Hummus, Erdnussbutter, Nussnougatcreme, Nocciolata, "
        "pâte à tartiner noisettes, pâte à tartiner chocolat, Nutella, "
        "BBQ-Sauce, Sojasauce, Honig, honig, honey, Sirup, "
        "sauce, confiture de fraise, confiture d abricot, moutarde, "
        "mermelada de fresa, mermelada de albaricoque, salsa de tomate, "
        "miel, miel de fleurs"
    ),
    "oils vinegars dressings": (
        "Öle, Essig und Dressings: Olivenöl, Rapsöl, Apfelessig, Salatdressing, "
        "Kokosöl, Sonnenblumenöl, Balsamico, Weinessig, aceite de oliva, "
        "huile d'olive, vinaigre, vinaigrette"
    ),
    "spices herbs seasoning": (
        "Gewürze, Kräuter und Würzmittel: Salz, Pfeffer, Paprikapulver edelsüß, "
        "Pimentón, Knoblauchpulver, Zimt, Kümmel, Gemüsebrühe, Bouillon, "
        "Curry, Oregano, Basilikum getrocknet, Thymian getrocknet, Cumin, "
        "getrocknete Kräuter, épices, herbes séchées, bouillon de légumes, "
        "pimenton dulce molido, especias"
    ),
    "baking ingredients": (
        "Backzutaten: Mehl, Weizenmehl, Dinkelmehl, Zucker, Backpulver, Hefe, "
        "Vanille, Puderzucker, Speisestärke, Natron, Kakaopulver, "
        "Schokoladendrops, harina de trigo, farine, sucre, levure, azúcar"
    ),
    "drinks beverages": (
        "Getränke: Fruchtsaft, Wasser, Mineralwasser, Kaffee, Tee, "
        "Milchgetränke, Softdrinks, Cola, Limonade, Eistee, Energydrink, "
        "Smoothie, jus d orange, eau minérale, café, thé, "
        "agua mineral, zumo, bebida, agua con gas"
    ),
    "personal care hygiene": (
        "Körperpflege und Hygiene: Shampoo, Duschgel, Zahnpasta, Deo, "
        "Hautcreme, Rasierer, Seife, Tampons, Windeln, Bodylotion, "
        "Sonnencreme, Mundwasser, shampooing antipelliculaire, gel douche, "
        "dentifrice, pasta dental, jabón, champú"
    ),
    "household cleaning": (
        "Haushalt und Reinigung: Spülmittel, Waschmittel, Allzweckreiniger, "
        "Schwämme, Müllbeutel, WC-Reiniger, Weichspüler, Küchentücher, "
        "liquide vaisselle, lessive, nettoyant, detergente lavadora, "
        "limpiador, limpiahogar"
    ),
    "frozen foods": (
        "Tiefkühlprodukte: Tiefkühlpizza, TK-Gemüse, Speiseeis, Eiscreme, "
        "Tiefkühlfisch, gefrorene Pommes Frites, TK-Fertiggerichte, Rahmspinat, "
        "Tiefkühlerbsen, Fischstäbchen, surgelés, légumes surgelés wok, "
        "pizza surgelée, pizza congelada, verduras congeladas, helado"
    ),
    "other": (
        "Sonstiges: Tiernahrung, Katzenfutter, Hundefutter, Büroartikel, "
        "Batterien, Kerzen, sonstige Non-Food-Produkte die keiner anderen "
        "Kategorie entsprechen"
    ),
}

# Concise taxonomy strings used by the cross-encoder reranker
RERANKER_TAXONOMY: dict[str, str] = {
    "fruit vegetables": "fresh fruit, vegetables, produce, herbs, mushrooms",
    "dairy eggs": "milk, cheese, yogurt, butter, eggs, cream, plant-based milk alternatives",
    "bread bakery pastries": "bread, rolls, toast, croissant, baguette, cake, pastry",
    "snacks chips nuts": "chocolate, candy, chips, crisps, nuts, cookies, protein bar, granola bar",
    "meat poultry fish seafood": "chicken, beef, pork, salmon, tuna, fish fillet, shrimp, sausage, deli meat",
    "grains rice pasta legumes": "pasta, spaghetti, rice, lentils, oats, chickpeas, beans, couscous, quinoa",
    "canned preserved foods": "canned tomatoes, canned tuna, canned beans, canned chickpeas, preserved food in tins or jars",
    "sauces spreads dips": "ketchup, mustard, pesto, jam, honey, nut butter, Nutella, hummus, BBQ sauce",
    "oils vinegars dressings": "olive oil, sunflower oil, vinegar, salad dressing",
    "spices herbs seasoning": "salt, pepper, paprika, cumin, oregano, stock cube, bouillon, dried herbs",
    "baking ingredients": "flour, sugar, baking powder, yeast, vanilla, cocoa powder",
    "drinks beverages": "juice, water, coffee, tea, soda, smoothie, energy drink, milk drink, protein shake, hot chocolate powder",
    "personal care hygiene": "shampoo, shower gel, toothpaste, deodorant, skin cream, sunscreen, soap",
    "household cleaning": "dish soap, laundry detergent, all-purpose cleaner, sponge, toilet cleaner",
    "frozen foods": "frozen pizza, frozen vegetables, ice cream, frozen fish, fish fingers, frozen fries, frozen ready meals",
    "other": "pet food, batteries, candles, non-food items",
}

# OpenFoodFacts taxonomy → internal bucket mapping
OFF_TO_BUCKET: dict[str, str] = {
    "en:condiments": "sauces spreads dips",
    "en:sauces": "sauces spreads dips",
    "en:dips": "sauces spreads dips",
    "en:vinegars": "oils vinegars dressings",
    "en:ketchup": "sauces spreads dips",
    "en:pestos": "sauces spreads dips",
    "en:hot-sauces": "sauces spreads dips",
    "en:soy-sauces": "sauces spreads dips",
    "en:fats": "oils vinegars dressings",
    "en:vegetable-oils": "oils vinegars dressings",
    "en:syrups": "sauces spreads dips",
    "en:agave-syrup": "sauces spreads dips",
    "en:honey": "sauces spreads dips",
    "en:breakfasts": "bread bakery pastries",
    "en:spreads": "sauces spreads dips",
    "en:sweet-spreads": "sauces spreads dips",
    "en:hazelnut-spreads": "sauces spreads dips",
    "en:chocolate-spreads": "sauces spreads dips",
    "en:cocoa-and-hazelnuts-spreads": "sauces spreads dips",
    "fr:pates-a-tartiner": "sauces spreads dips",
    "en:snacks": "snacks chips nuts",
    "en:salty-snacks": "snacks chips nuts",
    "en:candies": "snacks chips nuts",
    "en:confectioneries": "snacks chips nuts",
    "en:chips-and-fries": "snacks chips nuts",
    "en:potato-crisps": "snacks chips nuts",
    "en:dairies": "dairy eggs",
    "en:cheeses": "dairy eggs",
    "en:fermented-milk-products": "dairy eggs",
    "en:eggs": "dairy eggs",
    "en:meats": "meat poultry fish seafood",
    "en:prepared-meats": "meat poultry fish seafood",
    "en:sausages": "meat poultry fish seafood",
    "en:seafood": "meat poultry fish seafood",
    "en:fishes": "meat poultry fish seafood",
    "en:tunas": "meat poultry fish seafood",
    "en:fruits-and-vegetables-based-foods": "fruit vegetables",
    "en:fruit-and-vegetable-preserves": "sauces spreads dips",
    "en:jams": "sauces spreads dips",
    "en:berry-jams": "sauces spreads dips",
    "en:apple-compotes": "sauces spreads dips",
    "en:fruit-compotes": "sauces spreads dips",
    "en:apples": "fruit vegetables",
    "en:berries": "fruit vegetables",
    "en:apricots": "fruit vegetables",
    "en:cereals-and-their-products": "grains rice pasta legumes",
    "en:pastas": "grains rice pasta legumes",
    "en:noodles": "grains rice pasta legumes",
    "en:dry-pastas": "grains rice pasta legumes",
    "en:rice": "grains rice pasta legumes",
    "en:legumes": "grains rice pasta legumes",
    "en:beverages": "drinks beverages",
    "en:plant-based-beverages": "drinks beverages",
    "en:juices-and-nectars": "drinks beverages",
    "en:soft-drinks": "drinks beverages",
    "en:alcoholic-beverages": "drinks beverages",
    "en:gewurze": "spices herbs seasoning",
    "en:gewurzmittel": "spices herbs seasoning",
    "en:curry-pastes": "spices herbs seasoning",
    "en:herbs": "spices herbs seasoning",
    "en:spices": "spices herbs seasoning",
}

# Keyword overrides – fire before embedding (cheap, deterministic)
KEYWORD_OVERRIDES: dict[str, str] = {
    # produce
    "moehren": "fruit vegetables",
    "karotten": "fruit vegetables",
    "kartoffel": "fruit vegetables",
    "kartoffeln": "fruit vegetables",
    "zwiebel": "fruit vegetables",
    "zwiebeln": "fruit vegetables",
    "champignon": "fruit vegetables",
    "zucchini": "fruit vegetables",
    "brokkoli": "fruit vegetables",
    "spinat": "fruit vegetables",
    "zanahorias": "fruit vegetables",
    "aguacate": "fruit vegetables",
    "melone": "fruit vegetables",
    "honigmelone": "fruit vegetables",
    "honey melon": "fruit vegetables",
    "watermelon": "fruit vegetables",
    # frozen
    "tiefkuehl": "frozen foods",
    "frozen": "frozen foods",
    "ice cream": "frozen foods",
    "nuggets": "frozen foods",
    "fish fingers": "frozen foods",
    "surgeles": "frozen foods",
    "surgelado": "frozen foods",
    "congelado": "frozen foods",
    "congelada": "frozen foods",
    "congelados": "frozen foods",
    "speiseeis": "frozen foods",
    "eiscreme": "frozen foods",
    # cleaning
    "waschmittel": "household cleaning",
    "spuelmittel": "household cleaning",
    "weichspueler": "household cleaning",
    "detergente": "household cleaning",
    "limpiahogar": "household cleaning",
    "dish soap": "household cleaning",
    "dishwasher tablets": "household cleaning",
    "cleaner spray": "household cleaning",
    "cleaning spray": "household cleaning",
    "dishwasher": "household cleaning",
    # personal care
    "zahnpasta": "personal care hygiene",
    "duschgel": "personal care hygiene",
    "shampooing": "personal care hygiene",
    "champue": "personal care hygiene",
    "dental": "personal care hygiene",
    "sonnencreme": "personal care hygiene",
    # snacks
    "chips": "snacks chips nuts",
    "crisps": "snacks chips nuts",
    "crunchips": "snacks chips nuts",
    "pringles": "snacks chips nuts",
    "patatas fritas": "snacks chips nuts",
    # spices / seasoning
    "gemuesebruehe": "spices herbs seasoning",
    "huehnerbruehe": "spices herbs seasoning",
    "rinderbruehe": "spices herbs seasoning",
    "bruehwuerfel": "spices herbs seasoning",
    # dairy
    "freilandeier": "dairy eggs",
    "eier": "dairy eggs",
    # pet food → other
    "katzenfutter": "other",
    "hundefutter": "other",
    "tiernahrung": "other",
    "petfood": "other",
}

# ─── Text normalisation ───────────────────────────────────────────────────────

NORMALIZE_TRANS = str.maketrans({"ß": "ss", "ä": "ae", "ö": "oe", "ü": "ue"})
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
GRAM_WEIGHT_RE = re.compile(r"\b\d{2,3}\s*g\b")
SAUCE_NEIGHBOURS: frozenset[str] = frozenset(
    {"dressing", "sauce", "oel", "oil", "vinaigrette"}
)
BROTH_TOKENS: frozenset[str] = frozenset({"bouillon", "bruehe", "bruehwuerfel"})


def normalize_for_match(text: str) -> str:
    t = text.lower().translate(NORMALIZE_TRANS)
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode("ascii")
    return NON_ALNUM_RE.sub(" ", t).strip()


# ─── Pre-computed keyword lookup tables ──────────────────────────────────────

_NORMALIZED_OVERRIDES: dict[str, str] = {
    nk: v for k, v in KEYWORD_OVERRIDES.items() if (nk := normalize_for_match(k))
}

MULTI_WORD_OVERRIDES: dict[str, str] = {
    k: v for k, v in _NORMALIZED_OVERRIDES.items() if " " in k
}
SINGLE_WORD_OVERRIDES: dict[str, str] = {
    k: v for k, v in _NORMALIZED_OVERRIDES.items() if " " not in k
}
_PREFIX_OVERRIDES: dict[str, str] = {
    k: v for k, v in SINGLE_WORD_OVERRIDES.items() if len(k) >= 5
}
MULTI_WORD_OVERRIDE_ITEMS: list[tuple[str, str]] = sorted(
    MULTI_WORD_OVERRIDES.items(), key=lambda x: len(x[0]), reverse=True
)

PREFIX_OVERRIDES_BY_HEAD: dict[str, list[tuple[str, str]]] = {}
for _p, _l in _PREFIX_OVERRIDES.items():
    PREFIX_OVERRIDES_BY_HEAD.setdefault(_p[0], []).append((_p, _l))
for _opts in PREFIX_OVERRIDES_BY_HEAD.values():
    _opts.sort(key=lambda x: len(x[0]), reverse=True)

# ─── Reranker label texts ─────────────────────────────────────────────────────


def build_reranker_label_text(label: str) -> str:
    taxonomy = RERANKER_TAXONOMY[label]
    details = CLASS_DESCRIPTIONS.get(label, taxonomy)
    return f"{label}. taxonomy: {taxonomy}. details: {details}"


RERANKER_LABEL_TEXTS: dict[str, str] = {
    label: build_reranker_label_text(label) for label in CLASS_DESCRIPTIONS
}

# ─── LLM prompt templates ────────────────────────────────────────────────────

# shorten templates
SHORTEN_BATCH_TMPL = """
You are a product name normalizer. Shorten and normalize product names into a concise, recognizable format.

RULES:
1. Remove marketing and packaging terms (e.g. Bio, Extra, Classic, ohne Stücke, weniger Zucker, sizes/weights).
2. For jams/marmalades/spreads: keep flavor + product type; remove brand.
3. For branded snacks: keep brand + distinctive variant.
4. For non-branded items: keep core type (+ flavor if useful).
5. Cleanup: fix "Coucous" -> "Couscous" and remove parenthetical info.
6. Never translate; keep the original product language.

INPUT DATA:
Items: {items_list}
Categories: {category_list}

OUTPUT FORMAT: Return EXACTLY one JSON object. No extra text.
{{"original_item_name": "shortened_name"}}
"""

SHORTEN_TMPL = """
Shorten and normalize product name: "{input}"
Categories: "{categories}"

RULES:
1. Remove marketing/packaging terms (e.g. Bio, Extra, Natur, ohne/weniger Zucker, sizes/weights).
2. Jams/spreads: remove brand; keep flavor + product type.
3. Branded snacks: keep brand + distinctive variant.
4. Otherwise keep core product type (+ flavor if useful).
5. Fix spelling: Coucous -> Couscous.
6. Never translate; keep input language.

Return EXACTLY one JSON object:
{{"shortenedText":"result here"}}
"""

# category classification templates
Category_Batch_TMPL = """
You are a product classifier. Classify the given item names into one of the given classes.

INPUT DATA:
Items: {items_list}
Classes: {classes_list}

OUTPUT FORMAT: Return EXACTLY one JSON object (dictionary) that maps each original item name to its classified category.
The categories must be chosen only from the Classes provided.
For example:
{{"original_item_name_1": "classified_category_1", "original_item_name_2": "classified_category_2"}}
No extra text, explanations, or formatting—only the JSON object.
"""

# wish mapping templates
WISH_Batch_TMPL = """
You are a product-to-wish classifier.

TASK:
For each item, select the best matching wish from its wish list.

MATCHING RULES:
- The wish must appear as a WHOLE WORD or clear product term in the item name.
- Ignore adjectives, brands, packaging, and quantities.
- The wish must represent the SAME PRODUCT TYPE as the item — not an ingredient or component.
  - "apple juice" → NOT "apple" (ingredient)
  - "chocolate milk" → NOT "chocolate" (component)
- Variant-to-base mapping is allowed within the same product type.
  - "soy milk", "almond milk" → "milk"
  - "strawberry yogurt" → "yogurt"
- If multiple wishes match, prefer the most specific full-product-type match.

INPUT FORMAT:
Each item has a wish_list of candidate wishes and an index_wish_list identifying its source.
{item_wish_dict}

OUTPUT:
Return EXACTLY one JSON object. No explanations, no extra keys, no modified item names.
For each item output the matched wish from its wish_list and echo back its index_wish_list unchanged.

Example input:
{{
  "Bio apfelsaft": {{"wish_list": ["saft", "apfel", "wasser", "other"], "index_wish_list": 0}},
  "joghurt fettarm gut und günstig": {{"wish_list": ["joghurt", "milch", "other"], "index_wish_list": 1}},
  "Sésame": {{"wish_list": ["reis", "nudeln", "other"], "index_wish_list": 2}}
}}

Example output:
{{
  "Bio apfelsaft": {{"mapped_wish": "saft", "wish_list_index": 0}},
  "joghurt fettarm gut und günstig": {{"mapped_wish": "joghurt", "wish_list_index": 1}},
  "Sésame": {{"mapped_wish": other, "wish_list_index": 2}}
}}
"""

# action classification templates
PROMPT_TMPL = """
Find the item in the text: "{input}"

Options: {classes}

Return EXACTLY one JSON object and nothing else, e.g.:
{{"category":"snacks","confidence":0.95}}

- "category" must be one of the options above. If none match, return "unknown".
- "confidence" must be a float between 0.0 and 1.0.
"""

ACTION_PROMPT_TMPL = """
Determine the intent from this text: "{input}"

The user is either:
- ADDING/INCREMENTING an item (wants to buy it, add to list, etc.)
- REMOVING/DECREMENTING an item (bought it, remove from list, checked off, etc.)

Return EXACTLY one JSON object and nothing else, e.g.:
{{"action":"add","confidence":0.95}}

- "action" must be "add", "remove", or "unknown".
- "confidence" must be a float between 0.0 and 1.0.
"""

COMBINED_PROMPT_TMPL = """
Classify this grocery transcript in one pass.

Input text: "{input}"
Allowed item options: {classes}

Return EXACTLY one JSON object and nothing else, e.g.:
{{
    "category":"milk",
    "category_confidence":0.95,
    "action":"add",
    "action_confidence":0.91
}}

Rules:
- category must be one of the allowed options above, otherwise return "unknown".
- action must be "add", "remove", or "unknown".
- both confidence fields must be floats between 0.0 and 1.0.
"""
