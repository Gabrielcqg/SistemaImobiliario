from abc import ABC, abstractmethod
import re
import json
from typing import List, Optional, Any
from bs4 import BeautifulSoup
from app.models.offer import OfferCard

class PortalScraper(ABC):
    @abstractmethod
    def build_url(self, city: str, state: str, filters: dict, page: int) -> str:
        pass

    @abstractmethod
    def parse_cards(self, html: str, recency_days: int) -> List[OfferCard]:
        pass


    @abstractmethod
    def is_blocked(self, html: str) -> bool:
        pass
    
    @abstractmethod
    def is_incomplete(self, html: str) -> bool:
        pass

    @abstractmethod
    def extract_total_pages(self, html: str) -> int:
        pass

    def extract_details(self, html: str) -> dict:
        """Extracts detailed property specs from a detail page HTML."""
        return {}

    def _normalize_neighborhood(self, location_text: str) -> Optional[str]:
        """Extracts the neighborhood from a location string (e.g., 'Swiss Park, Campinas')."""
        if not location_text:
            return None
        # Split by comma and take the first part
        parts = [p.strip() for p in location_text.split(',')]
        if parts:
            return parts[0]
        return location_text.strip()

    def _extract_json_ld(self, html: str) -> List[Dict[str, Any]]:
        """Extracts all JSON-LD blocks from the HTML."""
        soup = BeautifulSoup(html, 'html.parser')
        json_ld_blocks = []
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string)
                if isinstance(data, list):
                    json_ld_blocks.extend(data)
                else:
                    json_ld_blocks.append(data)
            except (json.JSONDecodeError, TypeError):
                continue
        return json_ld_blocks
