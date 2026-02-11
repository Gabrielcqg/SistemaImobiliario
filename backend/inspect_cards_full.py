import logging
import requests
import time
import os
import sys
import re
from datetime import datetime
from bs4 import BeautifulSoup
from typing import List, Dict, Any

# Ensure we can import from app
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from app.scrapers.imovelweb import ImovelwebScraper
from app.scrapers.zap import ZapScraper
from app.scrapers.vivareal import VivaRealScraper

# Setup logging
logging.basicConfig(level=logging.ERROR) # Only valid errors

def get_headers():
    return {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
    }

def print_separator(title):
    print(f"\n{'='*60}")
    print(f" {title}")
    print(f"{'='*60}")

def analyze_portal(name, scraper_cls, start_url):
    print_separator(f"ANALYZING PORTAL: {name}")
    
    scraper = scraper_cls()
    
    # 1. Fetch
    print(f"🌍 Fetching URL: {start_url}")
    try:
        resp = requests.get(start_url, headers=get_headers(), timeout=15)
        html = resp.text
        status = resp.status_code
        print(f"✅ Status: {status} | Size: {len(html)} bytes")
        
        # Block check
        if scraper.is_blocked(html):
            print(f"🚨 BLOCKED! (Status: {status}, Size: {len(html)})")
            # Diagnosis
            signals = []
            if "<title>Access Denied</title>" in html: signals.append("Access Denied Title")
            if 'id="captcha"' in html: signals.append("Captcha ID")
            if "Just a moment" in html: signals.append("Just a moment text")
            if "_cf_chl" in html: signals.append("Cloudflare Challenge")
            print(f"   Signals detected: {', '.join(signals) or 'Unknown signature'}")
            
            with open(f"backend/debug_{name}_blocked.html", "w") as f: f.write(html)
            
            # If blocked, we stop analysis for this portal but count as failure
            print("   Marking as BLOCKED_WAF.")
            return "BLOCKED"
            
        # Save OK dump for debug if needed
        # with open(f"backend/debug_{name}_ok.html", "w") as f: f.write(html)
        
    except Exception as e:
        print(f"❌ Network Error: {e}")
        return "ERROR"

    # 2. Extract
    print(f"🕵️‍♂️ Running parse_cards...")
    cards = scraper.parse_cards(html, recency_days=9999)
    print(f"📊 Cards Found: {len(cards)}")
    
    if len(cards) == 0:
        print("⚠️ No cards found! Dumping sample HTML to terminal...")
        print(html[:1000])
        with open(f"backend/debug_{name}_failed.html", "w") as f: f.write(html)
        return
    
    # Save generic debug for inspection if cards found but might have issues
    with open(f"backend/debug_{name}_content.html", "w") as f: f.write(html)

    # 3. Validation
    ok_count = 0
    failed_count = 0
    failures = {} # type -> count
    sample_failures = [] 

    print("\n🔍 CHECKING FIRST 20 CARDS:")
    print(f"{'Result':<6} | {'Price':<10} | {'Area':<5} | {'Bed':<3} | {'Loc':<30} | {'Badge':<15} | {'Title'}")
    
    for i, card in enumerate(cards[:20]):
        missing = []
        
        # Required Fields
        if not card.url: missing.append("url")
        if not card.title: missing.append("title")
        if not card.price and card.price != 0: missing.append("price") # Allow 0 if explicitly set but usually price > 0
        if card.price == 0: missing.append("price_is_zero")
        
        # Specs
        if card.specs.area == 0: missing.append("area")
        if card.specs.bedrooms == 0 and card.portal != 'imovelweb': missing.append("bedrooms") # Imovelweb lofts might specify 0? usually 1
        
        # Location 
        # For validation, we require at least Neighborhood OR a valid address that implies it
        if not card.location.neighborhood: missing.append("neighborhood")
        if not card.location.city: missing.append("city")
        
        # Image
        if not card.main_image_url: missing.append("image")
        
        # Result
        status = "OK"
        if missing:
            status = "FAIL"
            failed_count += 1
            for m in missing: failures[m] = failures.get(m, 0) + 1
            if len(sample_failures) < 3:
                sample_failures.append({
                    "url": card.url,
                    "missing": missing,
                    "raw_loc": card.location.neighborhood if card.location else "None"
                })
        else:
            ok_count += 1
            
        # Print Row
        loc_str = f"{card.location.neighborhood or '?'}, {card.location.city or '?'}"
        if card.location.address: loc_str += f" ({card.location.address})"
        
        badge_str = ",".join(card.badges) if card.badges else "-"
        
        print(f"{status:<6} | {card.price:<10} | {card.specs.area:<5} | {card.specs.bedrooms:<3} | {loc_str[:30]:<30} | {badge_str[:15]:<15} | {card.title[:30]}...")

    # 4. Final Report
    print(f"\n📈 REPORT ({name}):")
    print(f"  Total: {len(cards)}")
    print(f"  OK: {ok_count}")
    print(f"  Failed: {failed_count}")
    if failures:
        print("  Failures by field:")
        for k, v in failures.items():
            print(f"    - {k}: {v}")
    
    if sample_failures:
        print("  Sample Failures:")
        for s in sample_failures:
            print(f"    - URL: {s['url']}")
            print(f"      Missing: {s['missing']}")
            print(f"      Raw Loc: {s['raw_loc']}")

if __name__ == "__main__":
    # URLs for Campinas (Standard Filter)
    
    # Imovelweb
    # https://www.imovelweb.com.br/apartamentos-venda-campinas-sp-ordem-publicado-maior.html
    url_iw = "https://www.imovelweb.com.br/apartamentos-venda-campinas-sp-ordem-publicado-maior.html"
    
    # VivaReal
    # https://www.vivareal.com.br/venda/sp/campinas/apartamento_residencial/?pagina=1
    url_vr = "https://www.vivareal.com.br/venda/sp/campinas/apartamento_residencial/?pagina=1"
    
    # Zap
    # https://www.zapimoveis.com.br/venda/apartamentos/sp+campinas/?pagina=1
    url_zap = "https://www.zapimoveis.com.br/venda/apartamentos/sp+campinas/?pagina=1"

    print("🚀 STARTING INSPECTION...")
    
    try:
        analyze_portal("imovelweb", ImovelwebScraper, url_iw)
    except Exception as e:
        print(f"CRITICAL ERROR IMOVELWEB: {e}")
        
    try:
        analyze_portal("vivareal", VivaRealScraper, url_vr)
    except Exception as e:
        print(f"CRITICAL ERROR VIVAREAL: {e}")
        
    try:
        analyze_portal("zap", ZapScraper, url_zap)
    except Exception as e:
        print(f"CRITICAL ERROR ZAP: {e}")
