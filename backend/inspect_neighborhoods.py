
import asyncio
from app.scrapers.stealth import StealthFetcher
from app.scrapers.vivareal import VivaRealScraper
from app.scrapers.zap import ZapScraper

async def inspect():
    fetcher = StealthFetcher()
    
    # VivaReal URL known to have issues/needs checking
    # I'll just pick a search page to see what parse_cards does
    url_viva = "https://www.vivareal.com.br/venda/sp/campinas/apartamento_residencial/"
    
    print(f"--- Inspecting VivaReal: {url_viva} ---")
    html_viva = await fetcher.fetch(url_viva)
    scraper_viva = VivaRealScraper()
    cards_viva = scraper_viva.parse_cards(html_viva, 365)
    
    for i, c in enumerate(cards_viva[:5]):
        print(f"[{i}] Title: {c.title}")
        print(f"    Neighborhood: {c.location.neighborhood if c.location else 'None'}")
        print(f"    Similarity: {c.title == (c.location.neighborhood if c.location else '')}")

    # Zap URL
    url_zap = "https://www.zapimoveis.com.br/venda/apartamentos/sp+campinas/"
    print(f"\n--- Inspecting Zap: {url_zap} ---")
    html_zap = await fetcher.fetch(url_zap)
    scraper_zap = ZapScraper()
    cards_zap = scraper_zap.parse_cards(html_zap, 365)
    
    for i, c in enumerate(cards_zap[:5]):
        print(f"[{i}] Title: {c.title}")
        print(f"    Neighborhood: {c.location.neighborhood if c.location else 'None'}")
        print(f"    Similarity: {c.title == (c.location.neighborhood if c.location else '')}")

    await fetcher.close()

if __name__ == "__main__":
    asyncio.run(inspect())
