from datetime import datetime, timezone, timedelta
from typing import Dict
from app.core.config import settings
from supabase import create_client, Client

from jobs.config import LISTING_TTL_DAYS

_supabase_client = None


def get_supabase() -> Client:
    """Get or create Supabase client using settings."""
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    return _supabase_client


def apply_lifecycle(ttl_days: int = LISTING_TTL_DAYS) -> Dict[str, int]:
    """
    Apply lifecycle rules to listings:
    - Listings not seen in ttl_days are marked as inactive.
    
    Returns count of inactivated listings.
    """
    supabase = get_supabase()
    cutoff = datetime.now(timezone.utc) - timedelta(days=ttl_days)
    cutoff_iso = cutoff.isoformat()
    
    # Count how many will be inactivated
    count_result = supabase.table("listings").select(
        "id", count="exact"
    ).eq(
        "is_active", True
    ).lt(
        "last_seen_at", cutoff_iso
    ).execute()
    
    count = count_result.count or 0
    
    if count > 0:
        # Inactivate them
        supabase.table("listings").update({
            "is_active": False,
            "inactive_reason": f"not_seen_{ttl_days}_days"
        }).eq(
            "is_active", True
        ).lt(
            "last_seen_at", cutoff_iso
        ).execute()
        
        print(f"🔄 [{count}] anúncios marcados como inativos (TTL: {ttl_days} dias)")
    
    return {"inactivated": count}


def reactivate_listing(listing_id: str):
    """Reactivate a specific listing (e.g., if it reappears)."""
    supabase = get_supabase()
    
    supabase.table("listings").update({
        "is_active": True,
        "inactive_reason": None,
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", listing_id).execute()


def get_lifecycle_stats() -> Dict[str, int]:
    """Get current lifecycle statistics."""
    supabase = get_supabase()
    
    active = supabase.table("listings").select(
        "id", count="exact"
    ).eq("is_active", True).execute()
    
    inactive = supabase.table("listings").select(
        "id", count="exact"
    ).eq("is_active", False).execute()
    
    return {
        "active": active.count or 0,
        "inactive": inactive.count or 0,
        "total": (active.count or 0) + (inactive.count or 0),
    }
