import asyncio
import logging
from app.scrapers.stealth import StealthFetcher
from app.scrapers.vivareal import VivaRealScraper

# Setup logging
logging.basicConfig(level=logging.INFO)

async def main():
    url = "https://www.vivareal.com.br/imovel/apartamento-4-quartos-cambui-campinas-com-garagem-535m2-venda-RS3200000-id-2790532333/"
    print(f"Fetching {url}...")
    
    fetcher = StealthFetcher(headless=True)
    html = await fetcher.fetch(url)
    
    if not html:
        print("Failed to fetch HTML")
        return

    print(f"HTML Length: {len(html)}")
    
    scraper = VivaRealScraper()
    details = scraper.extract_details(html)
    
    print("\n--- Extracted Details ---")
    print(details)
    
    if "date_text" in details:
        print(f"\n✅ Date Found: {details['date_text']}")
    else:
        print("\n❌ Date NOT Found")
        # Save HTML for inspection if needed (optional)
        with open("debug_vivareal.html", "w") as f:
            f.write(html)

if __name__ == "__main__":
    asyncio.run(main())
