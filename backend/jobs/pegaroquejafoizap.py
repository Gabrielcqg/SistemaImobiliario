import os
import re
import json
import time
import requests
from datetime import datetime
from zoneinfo import ZoneInfo
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client, Client

# ============================================================
# CONFIG
# ============================================================
load_dotenv()
TZ = ZoneInfo("America/Sao_Paulo")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("❌ Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no arquivo .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

# ============================================================
# INPUT (timestamp do log + URL)
# ============================================================
items_to_scrape = [
    ("2026-02-12 05:28:56", "https://www.zapimoveis.com.br/imovel/2870061806"),
    ("2026-02-11 22:25:25", "https://www.zapimoveis.com.br/imovel/2870000775"),
    ("2026-02-08 15:24:29", "https://www.zapimoveis.com.br/imovel/2869421687"),
    ("2026-02-12 08:31:05", "https://www.zapimoveis.com.br/imovel/2870094802"),
    ("2026-02-12 05:28:51", "https://www.zapimoveis.com.br/imovel/2870064777"),
    ("2026-02-12 05:29:00", "https://www.zapimoveis.com.br/imovel/2870063506"),
    ("2026-02-08 15:24:28", "https://www.zapimoveis.com.br/imovel/2869421979"),
    ("2026-02-16 16:32:54", "https://www.zapimoveis.com.br/imovel/2870739237"),
    ("2026-02-16 16:32:57", "https://www.zapimoveis.com.br/imovel/2870737346"),
    ("2026-02-16 20:28:56", "https://www.zapimoveis.com.br/imovel/2870767028"),
    ("2026-02-09 23:24:07", "https://www.zapimoveis.com.br/imovel/2869597037"),
    ("2026-02-12 05:29:01", "https://www.zapimoveis.com.br/imovel/2870064199"),
    ("2026-02-08 15:24:28", "https://www.zapimoveis.com.br/imovel/2869421978"),
    ("2026-02-08 15:24:28", "https://www.zapimoveis.com.br/imovel/2869421683"),
    ("2026-02-12 08:31:22", "https://www.zapimoveis.com.br/imovel/2870093405"),
    ("2026-02-12 05:29:01", "https://www.zapimoveis.com.br/imovel/2870065773"),
    ("2026-02-09 22:24:55", "https://www.zapimoveis.com.br/imovel/2869589914"),
    ("2026-02-12 05:28:55", "https://www.zapimoveis.com.br/imovel/2870065274"),
    ("2026-02-12 19:27:40", "https://www.zapimoveis.com.br/imovel/2870190103"),
    ("2026-02-12 05:28:58", "https://www.zapimoveis.com.br/imovel/2870065085"),
    ("2026-02-12 05:28:57", "https://www.zapimoveis.com.br/imovel/2870061811"),
    ("2026-02-16 16:32:49", "https://www.zapimoveis.com.br/imovel/2870737610"),
    ("2026-02-16 16:32:53", "https://www.zapimoveis.com.br/imovel/2870742183"),
    ("2026-02-16 16:32:53", "https://www.zapimoveis.com.br/imovel/2870743183"),
    ("2026-02-16 16:32:53", "https://www.zapimoveis.com.br/imovel/2870742583"),
    ("2026-02-12 05:29:02", "https://www.zapimoveis.com.br/imovel/2870064399"),
    ("2026-02-12 05:28:55", "https://www.zapimoveis.com.br/imovel/2870064992"),
    ("2026-02-09 22:24:58", "https://www.zapimoveis.com.br/imovel/2869592890"),
    ("2026-02-09 22:24:58", "https://www.zapimoveis.com.br/imovel/2869593375"),
    ("2026-02-12 05:29:01", "https://www.zapimoveis.com.br/imovel/2870065285"),
    ("2026-02-12 05:29:02", "https://www.zapimoveis.com.br/imovel/2870061826"),
    ("2026-02-12 19:27:37", "https://www.zapimoveis.com.br/imovel/2870192389"),
]

# ============================================================
# HELPERS
# ============================================================
def parse_log_ts(ts_str: str) -> str:
    dt = datetime.strptime(ts_str.strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ)
    return dt.isoformat()

def clean_number(text: str) -> float:
    if not text:
        return 0.0
    nums = re.sub(r"[^0-9,]", "", text)
    return float(nums.replace(",", ".")) if nums else 0.0

def pick_best_from_srcset(srcset: str) -> str | None:
    if not srcset: return None
    best_url, best_w = None, -1
    for part in srcset.split(","):
        tokens = part.strip().split()
        if not tokens: continue
        url = tokens[0].strip()
        w = int(re.search(r"(\d+)\s*w$", tokens[1]).group(1)) if len(tokens) > 1 and re.search(r"(\d+)\s*w$", tokens[1]) else 0
        if w > best_w:
            best_w, best_url = w, url
    return best_url

def looks_like_image_url(u: str) -> bool:
    if not u or not isinstance(u, str): return False
    if not (u.startswith("http://") or u.startswith("https://")): return False
    if any(x in u.lower() for x in ["icon", "favicon", "sprite", "logo"]): return False
    return bool(re.search(r"\.(jpg|jpeg|png|webp)(\?|$)", u.lower())) or ("resizedimgs" in u.lower())

def deep_find_first_image(obj):
    if obj is None: return None
    if isinstance(obj, str): return obj if looks_like_image_url(obj) else None
    if isinstance(obj, list):
        for it in obj:
            if got := deep_find_first_image(it): return got
        return None
    if isinstance(obj, dict):
        for k in ["image", "images", "cover", "coverImage", "mainImage", "photo", "photos", "media"]:
            if k in obj and (got := deep_find_first_image(obj.get(k))): return got
        for _, v in obj.items():
            if got := deep_find_first_image(v): return got
    return None

def extract_from_jsonld(soup: BeautifulSoup) -> dict:
    for s in soup.find_all("script", attrs={"type": "application/ld+json"}):
        txt = (s.string or "").strip()
        if not txt: continue
        try: return json.loads(txt)
        except:
            try: return json.loads(re.sub(r"\s+", " ", txt))
            except: continue
    return {}

def extract_from_next_data(soup: BeautifulSoup) -> dict:
    tag = soup.find("script", id="__NEXT_DATA__")
    if not tag: return {}
    try: return json.loads((tag.string or "").strip())
    except: return {}

def extract_complete_address_info(soup: BeautifulSoup) -> dict:
    data = {"street": "", "neighborhood": "", "city": "Campinas", "state": "SP"}
    tag = soup.find("p", {"data-testid": "location-address"})
    if not tag: tag = soup.find("p", class_=lambda c: c and "line-clamp-2" in c and "text-neutral-120" in c)
    if tag:
        full_text = tag.get_text(" ", strip=True)
        match = re.search(r"^(.*?) - (.*?), (.*?) - (\w{2})$", full_text)
        if match:
            data["street"], data["neighborhood"], data["city"], data["state"] = match.groups()
        else:
            data["street"] = full_text
    return data

def extract_zap_main_image(soup: BeautifulSoup) -> str | None:
    for sel in [('meta[property="og:image"]', "content"), ('meta[name="twitter:image"]', "content"), ('meta[property="og:image:secure_url"]', "content")]:
        tag = soup.select_one(sel[0])
        if tag and looks_like_image_url(u := (tag.get(sel[1]) or "").strip()): return u
    if ld := extract_from_jsonld(soup):
        if (u := deep_find_first_image(ld)) and looks_like_image_url(u): return u
    if nd := extract_from_next_data(soup):
        if (u := deep_find_first_image(nd)) and looks_like_image_url(u): return u
    if source := soup.select_one("picture source[srcset]"):
        if (best := pick_best_from_srcset(source.get("srcset", ""))) and looks_like_image_url(best): return best
    if img := soup.select_one("img[src], img[srcset]"):
        if looks_like_image_url(u := (img.get("src") or "").strip()): return u
        if (best := pick_best_from_srcset(img.get("srcset", ""))) and looks_like_image_url(best): return best
    html = str(soup)
    candidates = [c for c in re.findall(r"https?://[^\s\"'>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^\s\"'>]*)?", html, flags=re.IGNORECASE) if looks_like_image_url(c)]
    if candidates: return candidates[0]
    candidates2 = [c for c in re.findall(r"https?://resizedimgs\.[^\s\"'>]+", html, flags=re.IGNORECASE) if "action=" in c or "dimension=" in c]
    if candidates2: return candidates2[0]
    return None

def extract_title(soup: BeautifulSoup) -> str:
    if t := soup.select_one('meta[property="og:title"]'): return t.get("content").strip() if t.get("content") else ""
    if h1 := soup.find("h1"): return h1.get_text(strip=True)
    if soup.title: return soup.title.get_text(strip=True)
    return ""

def extract_price(soup: BeautifulSoup) -> float:
    ld = extract_from_jsonld(soup)
    if ld:
        def find_price(o):
            if isinstance(o, dict):
                if "offers" in o: return find_price(o["offers"])
                if "price" in o:
                    try: return float(str(o["price"]).replace(".", "").replace(",", "."))
                    except: pass
                for v in o.values():
                    if p := find_price(v): return p
            if isinstance(o, list):
                for it in o:
                    if p := find_price(it): return p
            return 0.0
        if p := find_price(ld): return float(p)
    text = soup.get_text(" ", strip=True)
    if m := re.search(r"R\$\s*([\d\.\,]+)", text): return clean_number(m.group(1))
    return 0.0

def extract_details_from_html(soup: BeautifulSoup) -> dict:
    data = {"usable_areas": 0, "bedrooms": 0, "bathrooms": 0, "parking_spaces": 0}
    mappings = {"Metragem": "usable_areas", "Quartos": "bedrooms", "Banheiros": "bathrooms", "Vagas": "parking_spaces"}
    for label_text, json_key in mappings.items():
        if label_tag := soup.find("p", string=re.compile(rf"^\s*{label_text}\s*$", re.IGNORECASE)):
            if parent_div := label_tag.find_parent("div"):
                if value_tag := parent_div.find("p", class_=lambda c: c and "font-bold" in c):
                    val = clean_number(value_tag.get_text(strip=True))
                    data[json_key] = int(val) if json_key != "usable_areas" else float(val)
    return data

def extract_property_type(soup: BeautifulSoup) -> str:
    """
    Mapeia os tipos de imóveis exatamente para o que o banco espera.
    Valores aceitos: 'apartment', 'house', 'other'.
    """
    title = extract_title(soup).lower()
    
    if "apartamento" in title or "apt" in title or "studio" in title or "kitnet" in title: 
        return "apartment" 
        
    if "casa" in title or "sobrado" in title: 
        return "house" 
        
    return "other"

# ============================================================
# CORE
# ============================================================
def processar_html_zap(ts_log: str, url: str):
    published_at_from_log = parse_log_ts(ts_log)
    print(f"\n🌍 Acessando: {url}")

    try:
        resp = requests.get(url, headers=HEADERS, timeout=25, allow_redirects=True)
        if resp.status_code != 200:
            print(f"❌ Erro HTTP {resp.status_code}")
            return

        soup = BeautifulSoup(resp.content, "html.parser")
        m = re.search(r"/imovel/(\d+)", url)
        ext_id = m.group(1) if m else "0"

        title = extract_title(soup)
        img_url = extract_zap_main_image(soup)
        price = extract_price(soup)
        details = extract_details_from_html(soup) 
        loc_data = extract_complete_address_info(soup)
        prop_type = extract_property_type(soup)
        
        print(f"   📍 Localização: {loc_data['neighborhood']} | {loc_data['city']}") 
        print(f"   🏢 Tipo: {prop_type} | Preço: {price} | Quartos: {details['bedrooms']}")

        payload = {
            "dedupe_key": f"zap_{ext_id}",
            "portal": "zap",
            "external_id": ext_id,
            "url": url,
            "title": title,
            "main_image_url": img_url,
            "price": float(price) if price else 0.0,
            "property_type": prop_type, 
            "area_m2": float(details["usable_areas"]),
            "bedrooms": int(details["bedrooms"]),
            "bathrooms": int(details["bathrooms"]),
            "parking": int(details["parking_spaces"]),
            "street": loc_data["street"],
            "neighborhood": loc_data["neighborhood"],
            "city": loc_data["city"],
            "state": loc_data["state"],
            "last_seen_at": datetime.now(TZ).isoformat(),
            "full_data": {
                "extracted_method": "zap_html_rescue_final",
                "raw_details": details,
                "raw_location": loc_data
            },
        }

        TABLE_NAME = "listings" 
        
        existing = (
            supabase.table(TABLE_NAME)
            .select("id, main_image_url")
            .eq("portal", payload["portal"])
            .eq("external_id", payload["external_id"])
            .execute()
        )
        
        if existing.data and len(existing.data) > 0:
            current = existing.data[0]
            payload_update = payload.copy()
            if not payload_update.get("main_image_url") and current.get("main_image_url"):
                payload_update["main_image_url"] = current["main_image_url"]
            
            supabase.table(TABLE_NAME).update(payload_update).eq("portal", payload["portal"]).eq("external_id", payload["external_id"]).execute()
            print(f"   🔄 Imóvel {ext_id} ATUALIZADO com sucesso.")
        else:
            payload["published_at"] = published_at_from_log
            payload["first_seen_at"] = datetime.now(TZ).isoformat()
            supabase.table(TABLE_NAME).insert(payload).execute()
            print(f"   💾 Imóvel {ext_id} INSERIDO com sucesso.")

    except Exception as e:
        print(f"🚨 Erro no link {url}: {e}")

# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    print(f"🚀 Iniciando resgate completo para {len(items_to_scrape)} imóveis (ZAP)...")
    for ts_log, link in items_to_scrape:
        processar_html_zap(ts_log, link)
        time.sleep(2)