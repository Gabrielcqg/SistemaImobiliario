import sys
import os
from sqlalchemy import text
from app.api.deps import get_db
from app.db.session import SessionLocal

# Setup DB session
db = SessionLocal()

def run_query(label, sql):
    print(f"\n--- {label} ---")
    try:
        result = db.execute(text(sql))
        rows = result.fetchall()
        if not rows:
            print("(No results)")
            return
            
        # Print headers
        keys = result.keys()
        print(" | ".join(keys))
        print("-" * (len(keys) * 15))
        
        for row in rows:
            print(row)
    except Exception as e:
        print(f"Error: {e}")

# 1. Counts per portal
sql_counts = """
SELECT 
    portal, 
    COUNT(*) as total, 
    COUNT(neighborhood) as has_nb_col, 
    COUNT(city) as has_city_col,
    COUNT(CASE WHEN location->>'neighborhood' IS NOT NULL THEN 1 END) as has_nb_json
FROM listings 
GROUP BY portal;
"""

# 2. Sample Data
sql_sample = """
SELECT 
    portal, 
    left(title, 20) as title, 
    price, 
    neighborhood, 
    city, 
    location 
FROM listings 
ORDER BY last_seen DESC 
LIMIT 10;
"""

if __name__ == "__main__":
    print("🚀 RUNNING SQL VALIDATION")
    run_query("COUNTS BY PORTAL", sql_counts)
    run_query("SAMPLE DATA", sql_sample)
