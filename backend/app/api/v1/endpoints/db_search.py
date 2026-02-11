"""
DB-Driven Search Endpoints: Queries the database instead of triggering scrapers.
"""
from fastapi import APIRouter, Query, HTTPException
from typing import Optional, List

router = APIRouter()

# Lazy load service to avoid import-time Supabase connection
_db_service = None

def get_db_service():
    global _db_service
    if _db_service is None:
        from app.services.db_search_service import DBSearchService
        _db_service = DBSearchService()
    return _db_service


@router.get("/db/search")
async def db_search(
    city: str = Query("campinas", description="City to search"),
    neighborhood: Optional[str] = Query(None, description="Neighborhood filter"),
    property_type: Optional[str] = Query(None, description="Property type (apartment, house, land, commercial)"),
    price_min: Optional[float] = Query(None, description="Minimum price"),
    price_max: Optional[float] = Query(None, description="Maximum price"),
    bedrooms_min: Optional[int] = Query(None, description="Minimum bedrooms"),
    bedrooms_max: Optional[int] = Query(None, description="Maximum bedrooms"),
    bathrooms_min: Optional[int] = Query(None, description="Minimum bathrooms"),
    parking_min: Optional[int] = Query(None, description="Minimum parking spots"),
    area_min: Optional[float] = Query(None, description="Minimum area (m²)"),
    area_max: Optional[float] = Query(None, description="Maximum area (m²)"),
    portals: Optional[str] = Query(None, description="Comma-separated portals (imovelweb,zap,vivareal)"),
    below_market_only: bool = Query(False, description="Only show below-market listings"),
    sort_by: str = Query("recent", description="Sort by: recent, price_asc, price_desc, opportunity"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Results per page"),
):
    """
    Search listings from the database.
    
    This endpoint does NOT trigger any scraping.
    Results come directly from the pre-populated database.
    
    Use the job `python -m jobs.scan_campinas` to populate the database.
    """
    portal_list = None
    if portals:
        portal_list = [p.strip() for p in portals.split(",")]
    
    result = get_db_service().search(
        city=city,
        neighborhood=neighborhood,
        property_type=property_type,
        price_min=price_min,
        price_max=price_max,
        bedrooms_min=bedrooms_min,
        bedrooms_max=bedrooms_max,
        bathrooms_min=bathrooms_min,
        parking_min=parking_min,
        area_min=area_min,
        area_max=area_max,
        portals=portal_list,
        below_market_only=below_market_only,
        sort_by=sort_by,
        page=page,
        page_size=page_size,
    )
    
    return result


@router.get("/db/listings/{listing_id}")
async def get_listing(listing_id: str):
    """Get a single listing by ID."""
    listing = get_db_service().get_listing_by_id(listing_id)
    if not listing:
        return {"error": "Listing not found"}
    return listing


@router.get("/db/neighborhoods")
async def get_neighborhoods(city: str = Query("campinas")):
    """Get list of neighborhoods with active listings."""
    neighborhoods = get_db_service().get_neighborhoods(city)
    return {"neighborhoods": neighborhoods, "count": len(neighborhoods)}


@router.get("/db/price-range")
async def get_price_range(city: str = Query("campinas")):
    """Get price range for active listings."""
    return get_db_service().get_price_range(city)


@router.get("/db/stats")
async def get_stats():
    """Get database statistics."""
    from jobs.pipeline.lifecycle import get_lifecycle_stats
    
    stats = get_lifecycle_stats()
    last_update = get_db_service()._get_last_update()
    
    return {
        "active_listings": stats.get("active", 0),
        "inactive_listings": stats.get("inactive", 0),
        "total_listings": stats.get("total", 0),
        "last_updated": last_update,
    }
