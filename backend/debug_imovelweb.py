import asyncio
import sys
import os

# Add the project root to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.scrapers.imovelweb import ImovelwebScraper
from app.scrapers.client import ScrapeDoClient

async def debug_imovelweb():
    scraper = ImovelwebScraper()
    client = ScrapeDoClient()
    
    filters = {
        "operation": "sale",
        "property_type": "apartment",
        "query": "taquaral",
        "city": "campinas",
        "state": "sp",
        "price_min": 4000000,
        "recency_days": 30
    }
    
    url = scraper.build_url("campinas", "sp", filters, 1)
    print(f"Debugging Imovelweb URL: {url}")
    
    # Try normal
    print("Attempting normal scrape...")
    resp = await client.get(url, render=False)
    print(f"Normal Status: {resp.status_code}")
    print(f"Normal Blocked: {scraper.is_blocked(resp.text)}")
    print(f"Normal Incomplete: {scraper.is_incomplete(resp.text)}")
    
    if scraper.is_blocked(resp.text) or scraper.is_incomplete(resp.text):
        print("Attempting Premium (Super Proxy) scrape...")
        resp = await client.get(url, render=True, premium=True)
        print(f"Premium Status: {resp.status_code}")
        print(f"Premium Blocked: {scraper.is_blocked(resp.text)}")
        print(f"Premium Incomplete: {scraper.is_incomplete(resp.text)}")
        
    with open("imovelweb_debug.html", "w", encoding="utf-8") as f:
        f.write(resp.text)
    print("Saved HTML to imovelweb_debug.html")
    
    cards = scraper.parse_cards(resp.text, recency_days=filters["recency_days"])
    print(f"\nTotal final: {len(cards)} cards extraídos.")
    for i, card in enumerate(cards):
        print(f"[{i}] {card.price:,.0f} | {card.title[:60]}...")

if __name__ == "__main__":
    asyncio.run(debug_imovelweb())
