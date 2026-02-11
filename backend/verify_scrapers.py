import asyncio
import sys
import os

# Add the project root to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.services.search_service import SearchService

async def test_scrapers():
    service = SearchService()
    filters = {
        "operation": "sale",
        "property_type": "apartment",
        "city": "campinas",
        "state": "sp",
        "query": "cambui",
        "price_min": 3500000,
        "price_max": 20000000,
        "recency_days": 30
    }
    
    print("Testing scrapers with filters:", filters)
    response = await service.search(filters, page=1)
    
    print("\nSearch Response Metadata:", response.metadata)
    print("Pagination Info:", response.pagination)
    print(f"Total results found: {len(response.results)}")
    
    if response.results:
        print("\nFirst 3 results details:")
        for idx, card in enumerate(response.results[:3]):
            print(f"\n[{idx+1}] Portal: {card.portal}")
            print(f"    Title: {card.title}")
            print(f"    Price: {card.price}")
            print(f"    Image: {card.main_image_url[:100] if card.main_image_url else 'NONE'}")
            print(f"    Neighborhood: {card.location.neighborhood}")
    else:
        print("\nNo results found!")

if __name__ == "__main__":
    async def main():
        try:
            await test_scrapers()
        except Exception as e:
            print(f"Error during test: {e}")
            import traceback
            traceback.print_exc()

    asyncio.run(main())
