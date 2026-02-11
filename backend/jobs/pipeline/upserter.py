from datetime import datetime, timezone
from typing import Dict, Any, Optional
from app.core.config import settings
from supabase import create_client, Client

_supabase_client: Optional[Client] = None


def get_supabase() -> Client:
    """Get or create Supabase client using settings."""
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    return _supabase_client


def upsert_listing(listing: Dict[str, Any]) -> Dict[str, Any]:
    """
    UPSERT a listing into the database.
    Returns the upserted record with metadata.
    
    Key behavior:
    - Uses (portal, external_id) as unique key
    - Detects price changes and tracks previous_price
    - Updates last_seen_at and scraped_at
    - Preserves first_seen_at for existing records
    """
    supabase = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    
    # Check if listing exists
    existing = supabase.table("listings").select("id, price, first_seen_at").eq(
        "portal", listing["portal"]
    ).eq(
        "external_id", listing["external_id"]
    ).execute()
    
    is_new = len(existing.data) == 0
    old_price = None
    listing_id = None
    
    if not is_new:
        existing_record = existing.data[0]
        listing_id = existing_record["id"]
        old_price = existing_record.get("price")
        # Preserve first_seen_at
        listing["first_seen_at"] = existing_record["first_seen_at"]
    else:
        listing["first_seen_at"] = now
    
    # Detect price change
    if old_price and listing.get("price") and old_price != listing["price"]:
        listing["previous_price"] = old_price
        listing["price_changed_at"] = now
    
    # Set timestamps
    listing["last_seen_at"] = now
    listing["scraped_at"] = now
    listing["is_active"] = True
    
    # Remove None values to avoid overwriting with nulls
    clean_listing = {k: v for k, v in listing.items() if v is not None}
    
    # UPSERT
    result = supabase.table("listings").upsert(
        clean_listing,
        on_conflict="portal,external_id"
    ).execute()
    
    if result.data:
        record = result.data[0]
        return {
            "id": record.get("id"),
            "is_new": is_new,
            "price_changed": old_price is not None and old_price != listing.get("price"),
            "old_price": old_price,
            "new_price": listing.get("price"),
        }
    
    return {"is_new": is_new, "price_changed": False}


def batch_upsert_listings(listings: list[Dict[str, Any]]) -> Dict[str, int]:
    """
    Batch UPSERT multiple listings.
    Returns counts of new, updated, and price_changed records.
    """
    stats = {
        "new": 0,
        "updated": 0,
        "price_changed": 0,
        "errors": 0,
    }
    
    for listing in listings:
        try:
            result = upsert_listing(listing)
            if result.get("is_new"):
                stats["new"] += 1
            else:
                stats["updated"] += 1
            if result.get("price_changed"):
                stats["price_changed"] += 1
        except Exception as e:
            print(f"❌ Error upserting {listing.get('url')}: {e}")
            stats["errors"] += 1
    
    return stats


def create_scrape_run(city: str, state: str, portals: list[str]) -> str:
    """Create a new scrape run record."""
    supabase = get_supabase()
    
    result = supabase.table("scrape_runs").insert({
        "city": city,
        "state": state,
        "portals": portals,
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
    }).execute()
    
    if result.data:
        return result.data[0]["id"]
    raise Exception("Failed to create scrape run")


def finish_scrape_run(
    run_id: str,
    status: str,
    total_cards: int = 0,
    total_upserted: int = 0,
    total_inactivated: int = 0,
    error_summary: Optional[Dict] = None
):
    """Finish a scrape run with final stats."""
    supabase = get_supabase()
    
    # Map internal status to valid DB values (constraint: running, completed, failed)
    if status in ('partial', 'ok', 'completed'):
        db_status = 'completed'
    elif status in ('blocked', 'error', 'failed'):
        db_status = 'failed'
    else:
        db_status = status  # Pass through 'running' or other valid values
    
    supabase.table("scrape_runs").update({
        "status": db_status,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "total_cards_found": total_cards,
        "total_upserted": total_upserted,
        "total_inactivated": total_inactivated,
        "error_summary": error_summary,
    }).eq("id", run_id).execute()


def log_scrape(
    run_id: str,
    portal: str,
    status_code: int = 200,
    duration_ms: int = 0,
    cards_collected: int = 0,
    cards_upserted: int = 0,
    error_msg: Optional[str] = None
):
    """Log a scrape operation."""
    supabase = get_supabase()
    
    supabase.table("scrape_logs").insert({
        "run_id": run_id,
        "portal": portal,
        "status_code": status_code,
        "duration_ms": duration_ms,
        "cards_collected": cards_collected,
        "cards_upserted": cards_upserted,
        "error_msg": error_msg,
    }).execute()
