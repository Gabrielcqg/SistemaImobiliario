from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from app.core.config import settings
from supabase import create_client, Client

_supabase_client: Optional[Client] = None


def get_supabase() -> Client:
    """Get or create Supabase client using settings."""
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    return _supabase_client


class DBSearchService:
    """
    Database-driven search service.
    Executes queries directly on the listings table.
    """
    
    def __init__(self):
        self.supabase = get_supabase()
    
    def search(
        self,
        city: str = "campinas",
        neighborhood: Optional[str] = None,
        property_type: Optional[str] = None,
        price_min: Optional[float] = None,
        price_max: Optional[float] = None,
        bedrooms_min: Optional[int] = None,
        bedrooms_max: Optional[int] = None,
        bathrooms_min: Optional[int] = None,
        parking_min: Optional[int] = None,
        area_min: Optional[float] = None,
        area_max: Optional[float] = None,
        portals: Optional[List[str]] = None,
        below_market_only: bool = False,
        sort_by: str = "recent",  # recent | price_asc | price_desc | opportunity
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        """
        Search listings with filters.
        Returns paginated results from the database.
        """
        # Start query
        query = self.supabase.table("listings").select(
            "id, portal, external_id, title, url, main_image_url, "
            "price, condo_fee, price_per_m2, "
            "area_m2, bedrooms, bathrooms, parking, "
            "neighborhood, city, state, "
            "first_seen_at, published_at, badges, below_market_badge, "
            "completeness_score, agency_name",
            count="exact"
        )
        
        # Filter: active only
        query = query.eq("is_active", True)
        
        # Filter: city (case insensitive)
        query = query.ilike("city", city)
        
        # Filter: neighborhood
        if neighborhood:
            query = query.ilike("neighborhood_normalized", neighborhood.lower())
        
        # Filter: property type
        if property_type:
            query = query.eq("property_type", property_type)
        
        # Filter: price range
        if price_min:
            query = query.gte("price", price_min)
        if price_max:
            query = query.lte("price", price_max)
        
        # Filter: bedrooms
        if bedrooms_min:
            query = query.gte("bedrooms", bedrooms_min)
        if bedrooms_max:
            query = query.lte("bedrooms", bedrooms_max)
        
        # Filter: bathrooms
        if bathrooms_min:
            query = query.gte("bathrooms", bathrooms_min)
        
        # Filter: parking
        if parking_min:
            query = query.gte("parking", parking_min)
        
        # Filter: area
        if area_min:
            query = query.gte("area_m2", area_min)
        if area_max:
            query = query.lte("area_m2", area_max)
        
        # Filter: portals
        if portals:
            query = query.in_("portal", portals)
        
        # Filter: below market only
        if below_market_only:
            query = query.eq("below_market_badge", True)
        
        # Sorting
        if sort_by == "recent":
            query = query.order("first_seen_at", desc=True)
        elif sort_by == "price_asc":
            query = query.order("price", desc=False)
        elif sort_by == "price_desc":
            query = query.order("price", desc=True)
        elif sort_by == "opportunity":
            # Sort by below_market first, then by recency
            query = query.order("below_market_badge", desc=True)
            query = query.order("first_seen_at", desc=True)
        else:
            query = query.order("first_seen_at", desc=True)
        
        # Pagination
        offset = (page - 1) * page_size
        query = query.range(offset, offset + page_size - 1)
        
        # Execute
        result = query.execute()
        
        # Transform results
        listings = []
        for row in result.data:
            listing = self._transform_listing(row)
            listings.append(listing)
        
        # Calculate pagination
        total_results = result.count or 0
        total_pages = (total_results + page_size - 1) // page_size
        
        # Get last update time
        last_update = self._get_last_update()
        
        return {
            "results": listings,
            "metadata": {
                "last_updated": last_update,
                "total_active_listings": self._get_active_count(),
            },
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total_results": total_results,
                "total_pages": total_pages,
                "has_next": page < total_pages,
            }
        }
    
    def _transform_listing(self, row: Dict) -> Dict:
        """Transform a database row into the API response format."""
        # Calculate days since published
        published_days_ago = None
        if row.get("published_at"):
            published_at = datetime.fromisoformat(row["published_at"].replace("Z", "+00:00"))
            published_days_ago = (datetime.now(timezone.utc) - published_at).days
        elif row.get("first_seen_at"):
            first_seen = datetime.fromisoformat(row["first_seen_at"].replace("Z", "+00:00"))
            published_days_ago = (datetime.now(timezone.utc) - first_seen).days
        
        return {
            "id": row.get("id"),
            "portal": row.get("portal"),
            "external_id": row.get("external_id"),
            "title": row.get("title"),
            "url": row.get("url"),
            "main_image_url": row.get("main_image_url"),
            "price": row.get("price"),
            "condo_fee": row.get("condo_fee"),
            "price_per_m2": row.get("price_per_m2"),
            "specs": {
                "area_m2": row.get("area_m2"),
                "bedrooms": row.get("bedrooms"),
                "bathrooms": row.get("bathrooms"),
                "parking": row.get("parking"),
            },
            "location": {
                "neighborhood": row.get("neighborhood"),
                "city": row.get("city"),
                "state": row.get("state"),
            },
            "published_days_ago": published_days_ago,
            "badges": row.get("badges") or [],
            "below_market": row.get("below_market_badge", False),
            "agency_name": row.get("agency_name"),
        }
    
    def _get_last_update(self) -> Optional[str]:
        """Get the timestamp of the last scrape run."""
        result = self.supabase.table("scrape_runs").select(
            "finished_at"
        ).eq(
            "status", "completed"
        ).order(
            "finished_at", desc=True
        ).limit(1).execute()
        
        if result.data:
            return result.data[0].get("finished_at")
        return None
    
    def _get_active_count(self) -> int:
        """Get count of active listings."""
        result = self.supabase.table("listings").select(
            "id", count="exact"
        ).eq("is_active", True).execute()
        return result.count or 0
    
    def get_listing_by_id(self, listing_id: str) -> Optional[Dict]:
        """Get a single listing by ID."""
        result = self.supabase.table("listings").select("*").eq("id", listing_id).execute()
        if result.data:
            return self._transform_listing(result.data[0])
        return None
    
    def get_neighborhoods(self, city: str = "campinas") -> List[str]:
        """Get list of neighborhoods with active listings."""
        result = self.supabase.table("listings").select(
            "neighborhood_normalized"
        ).eq(
            "is_active", True
        ).ilike(
            "city", city
        ).execute()
        
        # Unique neighborhoods
        neighborhoods = set()
        for row in result.data:
            if row.get("neighborhood_normalized"):
                neighborhoods.add(row["neighborhood_normalized"].title())
        
        return sorted(list(neighborhoods))
    
    def get_price_range(self, city: str = "campinas") -> Dict[str, float]:
        """Get min/max price range for active listings."""
        result = self.supabase.table("listings").select(
            "price"
        ).eq(
            "is_active", True
        ).ilike(
            "city", city
        ).not_.is_("price", "null").execute()
        
        prices = [row["price"] for row in result.data if row.get("price")]
        if prices:
            return {
                "min": min(prices),
                "max": max(prices),
            }
        return {"min": 0, "max": 0}
