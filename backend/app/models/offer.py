from typing import List, Optional, Dict
from pydantic import BaseModel
from datetime import datetime

class Specs(BaseModel):
    area: Optional[float] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None
    parking: Optional[int] = None

class Location(BaseModel):
    neighborhood: Optional[str] = None
    city: str
    state: str
    address: Optional[str] = None # Street address

class OfferCard(BaseModel):
    id: Optional[str] = None
    portal: str
    external_id: str
    title: str
    url: str
    main_image_url: Optional[str] = None
    agency_name: Optional[str] = None
    agency_logo_url: Optional[str] = None
    price: Optional[float] = None
    currency: str = "BRL"
    specs: Specs
    location: Location
    published_days_ago: Optional[int] = None
    published_at: Optional[datetime] = None
    last_seen: datetime
    badges: List[str] = []

class SearchResponse(BaseModel):
    results: List[OfferCard]
    metadata: Dict
    pagination: Optional[Dict] = None  # Expected keys: total_pages, page, page_size, has_next, total_results

