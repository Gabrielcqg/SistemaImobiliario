from bs4 import BeautifulSoup
import re

with open("debug_imovelweb.html", "r") as f:
    html = f.read()

soup = BeautifulSoup(html, "html.parser")
cards = soup.select('div[class*="postingCard-module__posting-container"]')

print(f"Cards found: {len(cards)}")

if cards:
    card = cards[0]
    # Try finding features
    f1 = card.select_one('div[class*="postingMainFeatures"]')
    print(f"Selector 1 (class*=postingMainFeatures): {f1 is not None}")
    
    f2 = card.find("div", class_=re.compile("postingMainFeatures"))
    print(f"Selector 2 (re.compile): {f2 is not None}")
    
    # Find ANY tag with postingMainFeatures
    f_any = card.find(class_=re.compile("postingMainFeatures"))
    if f_any:
        print(f"Found tag: <{f_any.name}> class={f_any.get('class')}")
    else:
        print("Not found in first card.")
        
    # Dump card html
    with open("debug_card.html", "w") as f:
        f.write(card.prettify())
