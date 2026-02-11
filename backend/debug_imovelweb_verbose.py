import asyncio
import sys
import os
from bs4 import BeautifulSoup

# Add the project root to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '.')))

from app.scrapers.imovelweb import ImovelwebScraper
from app.scrapers.client import ScrapeDoClient

async def debug_imovelweb_verbose():
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
    print(f"\n--- DEBUG START ---")
    print(f"URL: {url}")
    
    print("\nAttempting scrape with Scrape.do (Render=True, Premium=True)...")
    resp = await client.get(url, render=True, premium=True)
    print(f"Status Code: {resp.status_code}")
    
    html = resp.text
    print(f"HTML Length: {len(html)}")
    print(f"Is Blocked: {scraper.is_blocked(html)}")
    print(f"Is Incomplete: {scraper.is_incomplete(html)}")

    soup = BeautifulSoup(html, "html.parser")
    
    # Debugging selectors
    print("\n--- SELECTOR DEBUG ---")
    selectors = [
        'div[data-qa="POSTING_CARD"]',
        'div[class*="postingCard-module__posting-container"]',
        'div[class*="CardContainer"]',
        '.postingCard'
    ]
    
    for sel in selectors:
        found = soup.select(sel)
        print(f"Selector '{sel}': found {len(found)} elements")

    # Inspect one container if found
    listing_containers = soup.select('div[data-qa="POSTING_CARD"], div[class*="postingCard-module__posting-container"]')
    if listing_containers:
        print(f"\nAnalyzing first container of {len(listing_containers)}:")
        container = listing_containers[0]
        
        # Title
        title_elem = container.select_one('h3[class*="posting-description"] a, [data-qa="POSTING_CARD_DESCRIPTION"] a')
        print(f"  Title Element: {'found' if title_elem else 'NOT FOUND'}")
        if title_elem:
            print(f"  Title Text: {title_elem.get_text(strip=True)}")
            print(f"  Href: {title_elem.get('href')}")
            
        # Price
        price_elem = container.select_one('[data-qa*="PRICE"]')
        print(f"  Price Element: {price_elem.get_text(strip=True) if price_elem else 'NOT FOUND'}")
        
        # Location
        loc_elem = container.select_one('[data-qa*="LOCATION"]')
        print(f"  Location Element: {loc_elem.get_text(strip=True) if loc_elem else 'NOT FOUND'}")
        
        # Features
        features_elem = container.select_one('[data-qa*="FEATURES"]')
        print(f"  Features Element: {features_elem.get_text(strip=True) if features_elem else 'NOT FOUND'}")

        # Recency
        time_elem = container.select_one('div[class*="posting-antiquity-date"], [data-qa="POSTING_CARD_DATE"]')
        print(f"  Time Element: {time_elem.get_text(strip=True) if time_elem else 'NOT FOUND'}")
        
    else:
        print("\nNO CONTAINERS FOUND. Printing first 1000 chars of HTML for inspection:")
        print(html[:1000])

    print("\n--- DEBUG END ---")

if __name__ == "__main__":
    asyncio.run(debug_imovelweb_verbose())
