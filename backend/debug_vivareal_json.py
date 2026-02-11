import asyncio
import sys
import os
import json
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.scrapers.stealth import StealthFetcher

FIXED_URL = "https://www.vivareal.com.br/venda/sp/campinas/?transacao=venda&onde=%2CS%C3%A3o+Paulo%2CCampinas%2C%2C%2C%2C%2Ccity%2CBR%3ESao+Paulo%3ENULL%3ECampinas%2C-22.905082%2C-47.061333%2C&origem=busca-recente"

async def debug_next_data():
    fetcher = StealthFetcher(headless=True)
    try:
        print(f"Fetching {FIXED_URL}...")
        html = await fetcher.fetch(FIXED_URL)
        if not html:
            print("Empty HTML")
            return

        soup = BeautifulSoup(html, "html.parser")
        script = soup.find("script", {"id": "__NEXT_DATA__"})
        
        if not script:
            print("❌ __NEXT_DATA__ script NOT FOUND!")
            # Dump first 500 chars of HTML to check what's going on
            print("HTML Start:", html[:500])
            return

        print("✅ __NEXT_DATA__ found!")
        try:
            data = json.loads(script.string)
            print("Keys in root:", data.keys())
            
            # Recursive search for 'listing'
            found_listings = []
            def find_listings(obj, path=""):
                if isinstance(obj, dict):
                    if "listing" in obj:
                        l = obj["listing"]
                        
                        # Extract interesting fields
                        extracted = {
                            "id": l.get("id"),
                            "externalId": l.get("externalId"),
                            "createdAt": l.get("createdAt"),
                            "updatedAt": l.get("updatedAt"),
                            "publicationDate": l.get("publicationDate"),
                            "advertiser": l.get("advertiser", {}).get("name"),
                            "account": l.get("account", {}).get("name")
                        }
                        found_listings.append(extracted)
                        
                    for k, v in obj.items():
                        find_listings(v, path + "." + k)
                elif isinstance(obj, list):
                    for i, item in enumerate(obj):
                        find_listings(item, path + f"[{i}]")

            find_listings(data)
            
            print(f"Found {len(found_listings)} listing objects in JSON.")
            if found_listings:
                print("First 3 listings sample:")
                for l in found_listings[:3]:
                    print(l)
            else:
                print("No 'listing' objects found in JSON structure.")

        except Exception as e:
            print(f"Error parsing JSON: {e}")

    finally:
        await fetcher.close()

if __name__ == "__main__":
    asyncio.run(debug_next_data())
