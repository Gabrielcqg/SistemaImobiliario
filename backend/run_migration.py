import sys
import os
from sqlalchemy import text
from app.db.session import SessionLocal

db = SessionLocal()

sql = """
ALTER TABLE IF EXISTS public.client_filters
  ADD COLUMN IF NOT EXISTS deal_type text DEFAULT 'venda';

ALTER TABLE IF EXISTS public.listings
  ADD COLUMN IF NOT EXISTS deal_type text DEFAULT 'venda';

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
"""

def run_migration():
    print("🚀 Running Migration 016...")
    try:
        db.execute(text(sql))
        db.commit()
        print("✅ Migration applied successfully.")
    except Exception as e:
        print(f"❌ Error applying migration: {e}")
        db.rollback()

if __name__ == "__main__":
    run_migration()
