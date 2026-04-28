import base64
import sys
from pathlib import Path
from typing import Optional, cast

import dotenv
from openai import OpenAI

from utils.helpers_other import logModel

try:
    from utils.types_custom import CatalogueResponse
except ModuleNotFoundError:
    sys.path.append(str(Path(__file__).resolve().parents[1]))
    from utils.types_custom import CatalogueResponse


prompt = """
Extract all offers from the catalogue and return ONLY valid JSON matching the schema. No markdown, no explanatory text, no preamble.

Requirements:
- name: exact product name from catalogue, unchanged
- shortened_name: condensed name with brand, product type, and key specs (e.g., "Driscoll Himbeeren 100g")
- weight_g: integer in grams if the product is sold by weight, null otherwise
- volume_ml: integer in milliliters if the product is sold by volume, null otherwise
  (exactly one of weight_g / volume_ml should be non-null; both null if neither applies, e.g. a voucher)
- normal_price: regular price as float
- discount_price: discounted price as float
- discount_rate: discount as decimal (0.32 for 32%, not "32%" or "-32%")
- is_app_offer: true if app-exclusive, false otherwise

Splitting rules — each of the following creates a SEPARATE offer object:
1. App vs non-app: if a product has both a regular price and an app price, emit two objects
   (one with is_app_offer=false, one with is_app_offer=true)
2. Weight/volume variants: if a product lists multiple sizes (e.g. "100g - 160g"), emit one
   object per size, each with the correct weight_g or volume_ml set
3. Combine both rules: a product with two sizes AND an app price yields four objects

Return a JSON array of offer objects.
"""


def _get_model_config() -> tuple[str, str]:
    model = dotenv.get_key(".env", "MODEL_CATALOGUE")
    if model is None:
        model = dotenv.get_key(".env", "MODEL_CATALOGUE") or "openai/gpt-oss-20b"
    base_url = dotenv.get_key(".env", "OPENAI_API_BASE_URL_CATALOGUE")
    if model is None:
        model = dotenv.get_key(".env", "OPENAI_API_BASE_URL")
        
    if not model or not base_url:
        raise ValueError(
            f"You need to set both MODEL and OPENAI_API_BASE_URL in .env\n"
            f"MODEL={model}\nOPENAI_API_BASE_URL={base_url}"
        )
    return model, base_url


def getApiKeyCatalogue():
    key = dotenv.get_key(".env", "API_KEY_CATALOGUE")
    if not key:
        key = dotenv.get_key(".env", "API_KEY")
    return key
class CatalogueClassifier:
    def __init__(
        self, env_file_path: str = ".env", throw_exception_on_error: bool = True
    ) -> None:
        self.error: Optional[str] = None
        self.env_file_path: str = env_file_path
        dotenv.load_dotenv(self.env_file_path)

        try:
            self._model, self._base_url = _get_model_config()
        except ValueError as e:
            if throw_exception_on_error:
                raise
            self.error = str(e)
            return

        self._client = OpenAI(
            base_url=self._base_url,
            api_key=getApiKeyCatalogue(),
        )

    def _load_image_b64(self, img_path: str) -> str:
        try:
            with open(img_path, "rb") as f:
                return base64.standard_b64encode(f.read()).decode("utf-8")
        except Exception as e:
            raise Exception(f"Failed to load image at {img_path}: {e}") from e

    def classify_catalogue(
        self, img_path: str, verbose: bool = False
    ) -> CatalogueResponse:
        """Extract offers from catalogue image."""
        if verbose:
            print("Sending request to inference API...")

        image_b64 = self._load_image_b64(img_path)

        response = self._client.beta.chat.completions.parse(
            model=self._model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_b64}",
                                "detail": "high",
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            response_format=cast(type[CatalogueResponse], CatalogueResponse),
        )
        logModel(response, "catalogue_classifier", self._base_url)

        if verbose:
            print("Received response from inference API")

        catalogue_data = response.choices[0].message.parsed
        if catalogue_data is None:
            raise Exception(f"No valid response received for image: {img_path}")

        if verbose:
            print(f"\nExtracted {len(catalogue_data.offers)} offers:")
            for offer in catalogue_data.offers:
                print(f"  - {offer.shortened_name}: €{offer.discount_price}")
            print("=" * 60)
            print(catalogue_data.model_dump_json(indent=2))

        return catalogue_data


if __name__ == "__main__":
    classifier = CatalogueClassifier()
    content: CatalogueResponse = classifier.classify_catalogue(
        "/Users/bennetjollenbeck/Desktop/programming/web/react/family_projects/grocery-list2/server/server/supermarkets/uploads/20260427_180115_605e4bed-f214-46a3-89a7-245e982c3fba.png",
        verbose=True,
    )
