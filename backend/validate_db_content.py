import sys
import os
from collections import defaultdict

# Ensure we can import from app
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

from app.services.db_search_service import get_supabase

def run_validation():
    print("🚀 RUNNING DB CONTENT VALIDATION (via Supabase Client)")
    
    supabase = get_supabase()
    
    # Fetch all listings (or max 1000 for check)
    print("Fetching data...")
    # Select specific fields to verify
    resp = supabase.table("listings").select("portal, title, price, neighborhood, city, location").limit(1000).execute()
    data = resp.data
    
    if not data:
        print("❌ No data found in 'listings' table.")
        return

    print(f"Loaded {len(data)} rows.")
    
    # 1. Aggregation (Counts by Portal)
    stats = defaultdict(lambda: {"total": 0, "has_nb_col": 0, "has_city_col": 0, "has_nb_json": 0})
    
    for row in data:
        p = row.get("portal")
        stats[p]["total"] += 1
        if row.get("neighborhood"): stats[p]["has_nb_col"] += 1
        if row.get("city"): stats[p]["has_city_col"] += 1
        
        loc = row.get("location")
        if loc and isinstance(loc, dict) and loc.get("neighborhood"):
            stats[p]["has_nb_json"] += 1

    print("\n--- COUNTS BY PORTAL ---")
    print(f"{'Portal':<15} | {'Total':<8} | {'Has NB(Col)':<12} | {'Has City':<10} | {'Has NB(JSON)'}")
    print("-" * 75)
    for p, s in stats.items():
        print(f"{p:<15} | {s['total']:<8} | {s['has_nb_col']:<12} | {s['has_city_col']:<10} | {s['has_nb_json']}")

    # 2. Sample Data
    print("\n--- SAMPLE DATA (Last 10) ---")
    print(f"{'Portal':<10} | {'Title':<20} | {'Price':<10} | {'Nb(Col)':<20} | {'City':<10} | {'Nb(JSON)'}")
    print("-" * 90)
    for row in data[:10]:
        nb_json = "-"
        if row.get("location") and isinstance(row.get("location"), dict):
            nb_json = row["location"].get("neighborhood") or "-"
            
        print(f"{row.get('portal', '')[:10]:<10} | {row.get('title', '')[:20]:<20} | {str(row.get('price'))[:10]:<10} | {str(row.get('neighborhood'))[:20]:<20} | {row.get('city', '')[:10]:<10} | {nb_json}")

    # 3. Runs Validation
    print("\n--- RECENT RUNS (Last 5) ---")
    runs = supabase.table("scrape_runs").select("*").order("started_at", desc=True).limit(5).execute()
    if runs.data:
         print(f"{'ID':<36} | {'Status':<10} | {'Portals':<30} | {'Error Summary'}")
         print("-" * 100)
         for r in runs.data:
             summary = r.get("error_summary") or {}
             # Format summary for display
             summary_str = str(summary)[:60]
             print(f"{r.get('id'):<36} | {r.get('status', 'N/A'):<10} | {str(r.get('portals', [])):<30} | {summary_str}")
    else:
         print("(No runs found)")

if __name__ == "__main__":
    run_validation()
