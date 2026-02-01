from google import genai
from google.genai import types

from pydantic import BaseModel, Field
from typing import List, Optional
import dotenv
import os


prompt = """
Extract all offers from the catalogue and return ONLY valid JSON matching the schema. No markdown, no explanatory text, no preamble.

Requirements:
- name: exact product name from catalogue, unchanged
- shortened_name: condensed name with brand, product type, and key specs (e.g., "Driscoll Himbeeren 100g")
- weight_or_volume: integer in grams (solids) or milliliters (liquids), null if N/A
- normal_price: regular price as float
- discount_price: discounted price as float
- discount_rate: discount as decimal (0.32 for 32%, not "32%" or "-32%")
- is_app_offer: true if app-exclusive, false otherwise

Return a JSON array of offer objects.
"""


class Offer(BaseModel):
    name: str = Field(
        description="The full product name exactly as shown in catalogue"
    )
    shortened_name: str = Field(
        description="Condensed name with brand, type, and specifications (weight/volume/count)"
    )
    weight_or_volume: Optional[int] = Field(
        default=None,
        description="Weight in grams or volume in milliliters as integer, null if not applicable"
    )
    normal_price: float = Field(
        description="Regular price without discount"
    )
    discount_price: float = Field(
        description="Price after discount applied"
    )
    discount_rate: float = Field(
        description="Discount rate as decimal (e.g., 0.32 for 32% off)"
    )
    is_app_offer: bool = Field(
        description="True if offer requires app, false otherwise"
    )


class CatalogueResponse(BaseModel):
    offers: List[Offer] = Field(
        description="List of all offers extracted from the catalogue"
    )


class CatalogueClassifier:
    def __init__(
        self, env_file_path: str = ".env", throw_exception_on_error: bool = True
    ) -> None:
        self.error: Optional[str] = None
        self.env_file_path: str = env_file_path
        dotenv.load_dotenv(self.env_file_path)
        self.api_key: Optional[str] = os.getenv("google_api_key_ml")
        
        if not self.api_key:
            error_msg = f"Variable 'google_api_key_ml' not found in {self.env_file_path}"
            if throw_exception_on_error:
                raise KeyError(error_msg)
            else:
                self.error = error_msg

        self.model_name: str = "gemini-3-flash-preview"
        self.google_client = genai.Client(api_key=self.api_key)

    def _load_image(self, img_path: str) -> bytes:
        """Load image file and return bytes."""
        try:
            with open(img_path, "rb") as f:
                return f.read()
        except Exception as e:
            raise Exception(
                f"Failed to load image at {img_path}: {e}"
            ) from e

    def classify_catalogue(
        self, img_path: str, verbose: bool = False
    ) -> CatalogueResponse:
        """Extract offers from catalogue image."""
        if verbose:
            print("Sending request to inference API...")

        response = self.google_client.models.generate_content(
            model=self.model_name,
            contents=[
                types.Part.from_bytes(
                    data=self._load_image(img_path),
                    mime_type="image/jpeg",
                ),
                prompt,
            ],
            config={
                "response_mime_type": "application/json",
                "response_schema": CatalogueResponse,
            },
        )
        
        if verbose:
            print("Received response from inference API")

        if not response.text:
            raise Exception(f"No valid response received for image: {img_path}")

        catalogue_data: CatalogueResponse = CatalogueResponse.model_validate_json(response.text)

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
        "/Users/bennetjollenbeck/Downloads/im.png", 
        verbose=True
    )
    
        