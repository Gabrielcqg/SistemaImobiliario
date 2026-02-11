"""
Normalizer: Normalizes scraped data for consistent storage.
"""
import re
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone

from jobs.config import NEIGHBORHOOD_NORMALIZE_MAP, PROPERTY_TYPE_MAP, BADGE_KEYWORDS


def normalize_neighborhood(raw: Optional[str]) -> Optional[str]:
    """Normalize neighborhood name to consistent format."""
    if not raw:
        return None
    
    # Clean whitespace
    clean = raw.strip().lower()
    clean = re.sub(r'\s+', ' ', clean)
    
    # Check map first
    if clean in NEIGHBORHOOD_NORMALIZE_MAP:
        return NEIGHBORHOOD_NORMALIZE_MAP[clean]
    
    # Otherwise, title case
    return clean.title()


def normalize_property_type(raw: Optional[str], title: Optional[str] = None) -> str:
    """Normalize property type to enum value."""
    if raw:
        key = raw.strip().lower()
        if key in PROPERTY_TYPE_MAP:
            return PROPERTY_TYPE_MAP[key]
    
    # Infer from title if not explicit
    if title:
        title_lower = title.lower()
        for keyword, ptype in PROPERTY_TYPE_MAP.items():
            if keyword in title_lower:
                return ptype
    
    return "other"


def extract_badges_from_text(html: str, existing_badges: Optional[List[str]] = None) -> tuple[List[str], bool]:
    """
    Extract badges from HTML content.
    Returns (badges_list, has_below_market_badge).
    """
    badges = list(existing_badges) if existing_badges else []
    below_market = False
    html_lower = html.lower()
    
    for badge_key, keywords in BADGE_KEYWORDS.items():
        for keyword in keywords:
            if keyword in html_lower:
                if badge_key not in badges:
                    badges.append(badge_key)
                if badge_key == "preco_abaixo_do_mercado":
                    below_market = True
                break
    
    return badges, below_market


def calculate_completeness_score(listing: Dict[str, Any]) -> tuple[int, List[str]]:
    """
    Calculate completeness score (0-100) and list of missing fields.
    """
    required_fields = {
        "title": 10,
        "price": 20,
        "area_m2": 15,
        "bedrooms": 10,
        "bathrooms": 5,
        "neighborhood": 10,
        "main_image_url": 20,
        "description": 10,
    }
    
    score = 0
    missing = []
    
    for field, points in required_fields.items():
        value = listing.get(field)
        if value and (not isinstance(value, (int, float)) or value > 0):
            score += points
        else:
            missing.append(field)
    
    return score, missing


def normalize_price(raw: Any) -> Optional[float]:
    """Extract numeric price from various formats."""
    if raw is None:
        return None
    
    if isinstance(raw, (int, float)):
        return float(raw)
    
    if isinstance(raw, str):
        # Remove currency symbols, dots (thousands), keep comma (decimal)
        clean = re.sub(r'[R$\s.]', '', raw)
        clean = clean.replace(',', '.')
        try:
            return float(clean)
        except ValueError:
            return None
    
    return None


def normalize_area(raw: Any) -> Optional[float]:
    """Extract numeric area from various formats."""
    if raw is None:
        return None
    
    if isinstance(raw, (int, float)):
        return float(raw)
    
    if isinstance(raw, str):
        # Extract first number
        match = re.search(r'(\d+(?:[.,]\d+)?)', raw)
        if match:
            val = match.group(1).replace(',', '.')
            return float(val)
    
    return None


def normalize_int_field(raw: Any) -> Optional[int]:
    """Extract integer from various formats."""
    if raw is None:
        return None
    
    if isinstance(raw, int):
        return raw
    
    if isinstance(raw, float):
        return int(raw)
    
    if isinstance(raw, str):
        match = re.search(r'(\d+)', raw)
        if match:
            return int(match.group(1))
    
    return None


def normalize_listing(raw_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize a raw scraped listing into the standard schema.
    """
    # Extract from nested structures if present
    specs = raw_data.get("specs", {})
    location = raw_data.get("location", {})
    
    # Normalize neighborhood
    neighborhood = raw_data.get("neighborhood") or location.get("neighborhood")
    neighborhood_normalized = normalize_neighborhood(neighborhood)
    
    # Normalize property type
    property_type = normalize_property_type(
        raw_data.get("property_type"),
        raw_data.get("title")
    )
    
    # Normalize numeric fields
    price = normalize_price(raw_data.get("price"))
    area_m2 = normalize_area(raw_data.get("area_m2") or specs.get("area"))
    bedrooms = normalize_int_field(raw_data.get("bedrooms") or specs.get("bedrooms"))
    bathrooms = normalize_int_field(raw_data.get("bathrooms") or specs.get("bathrooms"))
    parking = normalize_int_field(raw_data.get("parking") or specs.get("parking"))
    condo_fee = normalize_price(raw_data.get("condo_fee"))
    iptu = normalize_price(raw_data.get("iptu"))
    
    # Build normalized listing
    normalized = {
        "portal": raw_data.get("portal"),
        "external_id": raw_data.get("external_id"),
        "url": raw_data.get("url"),
        "title": raw_data.get("title"),
        "description": raw_data.get("description"),
        "price": price,
        "condo_fee": condo_fee,
        "iptu": iptu,
        "city": raw_data.get("city") or location.get("city", "Campinas"),
        "state": raw_data.get("state") or location.get("state", "SP"),
        "neighborhood": neighborhood,
        "neighborhood_normalized": neighborhood_normalized,
        "property_type": property_type,
        "area_m2": area_m2,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "parking": parking,
        "main_image_url": raw_data.get("main_image_url"),
        "images": raw_data.get("images"),
        "badges": raw_data.get("badges", []),
        "below_market_badge": raw_data.get("below_market_badge", False),
        "has_virtual_tour": raw_data.get("has_virtual_tour", False),
        "published_at": raw_data.get("published_at"),
        "agency_name": raw_data.get("agency_name"),
    }
    
    # Calculate completeness
    completeness, missing = calculate_completeness_score(normalized)
    normalized["completeness_score"] = completeness
    normalized["missing_fields"] = missing
    
    return normalized
