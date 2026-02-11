from bs4 import BeautifulSoup
import json

with open("imovelweb_debug.html", "r", encoding="utf-8") as f:
    html = f.read()

soup = BeautifulSoup(html, "html.parser")
listing_containers = soup.select('div[class*="postingCard-module__posting-container"]')

if listing_containers:
    print(f"Found {len(listing_containers)} containers. Inspecting first one:")
    container = listing_containers[0]
    print("\n--- RAW HTML START ---")
    print(container.prettify())
    print("--- RAW HTML END ---")
else:
    print("No containers found using that selector.")
