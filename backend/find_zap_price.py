from bs4 import BeautifulSoup
import re

with open("backend/debug_zap_content.html", "r") as f:
    html = f.read()

soup = BeautifulSoup(html, "html.parser")

# Find the card with the specific ID from the log
target_url_part = "2852308963"
# The scraper found this URL, so the anchor must exist
anchor = soup.find("a", href=re.compile(target_url_part))

if anchor:
    print("Found anchor!")
    # Go up to container
    # Zap container is usually the anchor itself or a parent
    # Let's inspect the anchor text and children
    print(f"Anchor text: {anchor.get_text()[:100]}")
    
    # Check for price inside anchor
    print("--- Searching for Price pattern in Anchor ---")
    text = anchor.get_text(" | ", strip=True)
    print(text)
    
    # Check specific elements
    # Zap often uses p or h3 for price
    prices = anchor.find_all(string=re.compile(r"R\$"))
    for p in prices:
        print(f"Found price candidate: '{p}' in tag <{p.parent.name} class='{p.parent.get('class')}'>")

else:
    print("Anchor NOT found!")
