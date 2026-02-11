
import asyncio
import sys
from datetime import datetime
from app.scrapers.stealth import StealthFetcher
from app.scrapers.vivareal import VivaRealScraper
from app.scrapers.imovelweb import ImovelwebScraper
from app.scrapers.zap import ZapScraper

# Configuration
PORTALS = {
    "vivareal": {
        "url": "https://www.vivareal.com.br/venda/sp/campinas/apartamento_residencial/",
        "scraper": VivaRealScraper
    },
    "zap": {
        "url": "https://www.zapimoveis.com.br/venda/apartamentos/sp+campinas/",
        "scraper": ZapScraper
    },
    "imovelweb": {
        "url": "https://www.imovelweb.com.br/apartamentos-venda-campinas-sp-ordem-publicado-maior.html",
        "scraper": ImovelwebScraper
    }
}

async def run_diagnostic():
    fetcher = StealthFetcher()
    
    print("="*60)
    print(f"🕵️  SCRAPER DIAGNOSTIC TOOL - {datetime.now().isoformat()}")
    print("="*60)
    
    overall_success = True

    for name, config in PORTALS.items():
        print(f"\n\n🔍 DIAGNOSING: {name.upper()}")
        print("-" * 40)
        
        url = config["url"]
        print(f"🌐 Fetching URL: {url}")
        
        # A) Page Health
        try:
            html = await fetcher.fetch(url)
        except Exception as e:
            print(f"❌ FETCH FAIL: {e}")
            overall_success = False
            continue

        size = len(html)
        print(f"📄 HTML Size: {size} chars")

        # Check for blocking indicators
        blocked_triggers = ["Just a moment", "_cf_chl", "challenge-platform", "Attention Required", "Access Denied"]
        is_blocked = any(t in html for t in blocked_triggers)
        if is_blocked:
            print("⚠️  BLOCKED DETECTED! (Cloudflare/Challenge)")
            filename = f"debug_{name}_blocked.html"
            with open(filename, "w", encoding="utf-8") as f:
                f.write(html)
            print(f"💾 Saved blocked HTML to {filename}")
        
        # B) Card Detection
        scraper = config["scraper"]()
        try:
            # We assume scrapers have a parse_cards that takes specific args?
            # Or we can just inspect the soup logic if we want to be pure.
            # But better to test the actual method.
            # NOTE: Scrapers signature might be parse_cards(html, max_days)
            cards = scraper.parse_cards(html, 9999) # 9999 days to accept all
        except Exception as e:
            print(f"❌ PARSE CRASH: {e}")
            import traceback
            traceback.print_exc()
            overall_success = False
            continue

        cards_found = len(cards)
        print(f"🃏 Cards Found: {cards_found}")
        
        if cards_found == 0:
            print("❌ FAILURE: No cards found.")
            filename = f"debug_{name}_nocards.html"
            with open(filename, "w", encoding="utf-8") as f:
                f.write(html)
            print(f"💾 Saved HTML to {filename} for inspection")
            overall_success = False
            continue

        # C) Field Validation (Full Test)
        cards_parsed_ok = 0
        cards_failed = 0
        failures_summary = {} # key: missing_field, value: count
        sample_failures = []
        
        print("\n🧐 Validating first 20 cards...")

        for i, card in enumerate(cards[:20]):
            missing = []
            
            # Check mandatory fields
            if not card.portal: missing.append("portal")
            if not card.external_id: missing.append("external_id")
            if not card.url: missing.append("url")
            if not card.title: missing.append("title")
            
            # Price - allow 0 if strictly valid but usually > 0
            if card.price is None: missing.append("price")
            
            # Specs
            if not card.specs:
                missing.append("specs")
            else:
                # Some might be None validly (e.g. land has no bedrooms), but user wants apartments
                # We are searching apartments, so we expect some basics.
                # But let's be strict on object existence at least.
                pass 
            
            if not card.main_image_url: missing.append("main_image_url")
            
            # Location
            if not card.location:
                missing.append("location")
            else:
                if not card.location.city: missing.append("location.city")
                # Neighborhood strict check
                if not card.location.neighborhood: 
                    missing.append("location.neighborhood")
                elif card.title and card.location.neighborhood.strip().lower() == card.title.strip().lower():
                    missing.append("neighborhood_equals_title")
            
            # Specific checks for "street" if VivaReal?
            # User said "street (quando existir no card, ex VivaReal)"
            # We won't fail strictly on street, but nice to know.

            if not missing:
                print(f"✅ Card {i}: OK | {card.title[:30]}... | {card.location.neighborhood}, {card.location.city}")
                cards_parsed_ok += 1
            else:
                print(f"❌ Card {i}: FAIL | {card.title[:30]}...")
                print(f"   Missing/Bad: {missing}")
                if "location.neighborhood" in missing or "neighborhood_equals_title" in missing:
                    # Try to finding raw location text to debug
                    print(f"   [DEBUG] Raw Location Text might be issue. See dumped HTML.")
                
                cards_failed += 1
                for m in missing:
                    failures_summary[m] = failures_summary.get(m, 0) + 1
                
                if len(sample_failures) < 3:
                    sample_failures.append({
                        "i": i,
                        "title": card.title,
                        "url": card.url,
                        "missing": missing
                    })

        # D) Report
        print(f"\n📊 [{name.upper()}] REPORT")
        print(f"   Found: {cards_found}")
        print(f"   OK: {cards_parsed_ok}")
        print(f"   Failed: {cards_failed}")
        if failures_summary:
            print("   Failures by Field:")
            for k, v in failures_summary.items():
                print(f"     - {k}: {v}")
        
        if sample_failures:
            print("   ⚠️  Sample Failures:")
            for f in sample_failures:
                print(f"     [{f['i']}] {f['url']} -> Missing: {f['missing']}")

        if cards_failed > 0 or cards_found == 0:
            overall_success = False
            # DUMP HTML FOR INSPECTION
            filename = f"debug_{name}_failed.html"
            with open(filename, "w", encoding="utf-8") as f:
                f.write(html)
            print(f"💾 Saved HTML to {filename} (due to failures)")

    await fetcher.close()
    
    if not overall_success:
        print("\n\n❌ DIAGNOSTIC FAILED: Some portals have issues.")
        sys.exit(1)
    else:
        print("\n\n✅ DIAGNOSTIC PASSED: All portals healthy.")
        sys.exit(0)

if __name__ == "__main__":
    asyncio.run(run_diagnostic())
