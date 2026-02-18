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
# INPUT (timestamp do seu log + URL)
# - published_at no INSERT vai usar esse timestamp do log
# - no UPDATE a gente preserva published_at do banco
# ============================================================
items_to_scrape = [
    ("2026-02-16 13:32:49", "https://www.zapimoveis.com.br/imovel/2870737610"),
    ("2026-02-16 13:32:53", "https://www.zapimoveis.com.br/imovel/2870742183"),
    ("2026-02-16 13:32:53", "https://www.zapimoveis.com.br/imovel/2870743183"),
    ("2026-02-16 13:32:53", "https://www.zapimoveis.com.br/imovel/2870742583"),
    ("2026-02-16 13:32:54", "https://www.zapimoveis.com.br/imovel/2870739237"),
    ("2026-02-16 13:32:56", "https://www.zapimoveis.com.br/imovel/2870738147"),
    ("2026-02-16 13:32:56", "https://www.zapimoveis.com.br/imovel/2870743197"),
    ("2026-02-16 13:32:56", "https://www.zapimoveis.com.br/imovel/2870741444"),
    ("2026-02-16 13:32:57", "https://www.zapimoveis.com.br/imovel/2870743786"),
    ("2026-02-16 13:32:57", "https://www.zapimoveis.com.br/imovel/2870737346"),
    ("2026-02-16 13:32:57", "https://www.zapimoveis.com.br/imovel/2870737347"),
    ("2026-02-16 13:32:58", "https://www.zapimoveis.com.br/imovel/2870741325"),
    ("2026-02-16 13:32:59", "https://www.zapimoveis.com.br/imovel/2870737662"),
    ("2026-02-16 15:24:40", "https://www.zapimoveis.com.br/imovel/2870759903"),
    ("2026-02-16 17:28:56", "https://www.zapimoveis.com.br/imovel/2870767028"),
]

# ============================================================
# HELPERS
# ============================================================
def parse_log_ts(ts_str: str) -> str:
    # log já está em horário de SP
    dt = datetime.strptime(ts_str.strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ)
    return dt.isoformat()

def clean_number(text: str) -> float:
    if not text:
        return 0.0
    nums = re.sub(r"[^0-9,]", "", text)
    return float(nums.replace(",", ".")) if nums else 0.0

def pick_best_from_srcset(srcset: str) -> str | None:
    if not srcset:
        return None
    best_url = None
    best_w = -1
    for part in srcset.split(","):
        tokens = part.strip().split()
        if not tokens:
            continue
        url = tokens[0].strip()
        w = 0
        if len(tokens) > 1:
            m = re.search(r"(\d+)\s*w$", tokens[1])
            if m:
                w = int(m.group(1))
        if w > best_w:
            best_w = w
            best_url = url
    return best_url

def looks_like_image_url(u: str) -> bool:
    if not u or not isinstance(u, str):
        return False
    if not (u.startswith("http://") or u.startswith("https://")):
        return False
    # evita pegar ícones/avatars
    if any(x in u.lower() for x in ["icon", "favicon", "sprite", "logo"]):
        return False
    return bool(re.search(r"\.(jpg|jpeg|png|webp)(\?|$)", u.lower())) or ("resizedimgs" in u.lower())

def deep_find_first_image(obj):
    """
    Varre recursivamente dict/list procurando alguma string que pareça URL de imagem.
    Retorna a primeira encontrada.
    """
    if obj is None:
        return None
    if isinstance(obj, str):
        return obj if looks_like_image_url(obj) else None
    if isinstance(obj, list):
        for it in obj:
            got = deep_find_first_image(it)
            if got:
                return got
        return None
    if isinstance(obj, dict):
        # prioriza chaves comuns
        for k in ["image", "images", "cover", "coverImage", "mainImage", "photo", "photos", "media"]:
            if k in obj:
                got = deep_find_first_image(obj.get(k))
                if got:
                    return got
        for _, v in obj.items():
            got = deep_find_first_image(v)
            if got:
                return got
        return None
    return None

def extract_from_jsonld(soup: BeautifulSoup) -> dict:
    """
    Extrai o primeiro JSON-LD parseável.
    """
    scripts = soup.find_all("script", attrs={"type": "application/ld+json"})
    for s in scripts:
        txt = (s.string or "").strip()
        if not txt:
            continue
        try:
            data = json.loads(txt)
            return data
        except Exception:
            # às vezes vem lista com lixo; tenta limpar básico
            try:
                txt2 = re.sub(r"\s+", " ", txt)
                data = json.loads(txt2)
                return data
            except Exception:
                continue
    return {}

def extract_from_next_data(soup: BeautifulSoup) -> dict:
    """
    Pega __NEXT_DATA__ (muito comum em sites React/Next).
    """
    tag = soup.find("script", id="__NEXT_DATA__")
    if not tag:
        return {}
    txt = (tag.string or "").strip()
    if not txt:
        return {}
    try:
        return json.loads(txt)
    except Exception:
        return {}

def extract_complete_address_info(soup: BeautifulSoup) -> dict:
    """
    Busca o endereço no elemento com data-testid="location-address"
    e faz o parse: "Rua X, 123 - Bairro, Cidade - SP"
    """
    data = {
        "street": "",
        "neighborhood": "",
        "city": "Campinas", # Valor default
        "state": "SP"       # Valor default
    }

    # 1. Pega o elemento exato do seu print
    tag = soup.find("p", {"data-testid": "location-address"})
    
    if not tag:
        # Fallback: tenta procurar pela classe se o testid falhar
        tag = soup.find("p", class_=lambda c: c and "line-clamp-2" in c and "text-neutral-120" in c)
    
    if tag:
        full_text = tag.get_text(" ", strip=True) # Ex: "Rua Regente Feijó, 403 - Centro, Campinas - SP"
        
        # 2. Regex para capturar os grupos baseado na sua explicação:
        # Grupo 1: Rua e número (tudo antes do primeiro " - ")
        # Grupo 2: Bairro (entre " - " e a vírgula)
        # Grupo 3: Cidade (entre a vírgula e o último " - ")
        # Grupo 4: Estado (final)
        # Regex explica: Pega tudo (.*?) até " - ", pega tudo até ",", pega tudo até " - ", pega o resto.
        match = re.search(r"^(.*?) - (.*?), (.*?) - (\w{2})$", full_text)
        
        if match:
            data["street"] = match.group(1).strip()       # "Rua Regente Feijó, 403"
            data["neighborhood"] = match.group(2).strip() # "Centro"
            data["city"] = match.group(3).strip()         # "Campinas"
            data["state"] = match.group(4).strip()        # "SP"
        else:
            # Caso o formato seja diferente (ex: sem número ou sem bairro explícito),
            # tentamos uma estratégia de split mais simples
            parts = full_text.split(" - ")
            if len(parts) >= 3:
                # [Rua, Bairro+Cidade, SP] ??? O padrão do Zap costuma ser 3 partes separadas por hífen?
                # Na verdade o seu exemplo tem 2 hifens: "Rua - Bairro, Cidade - SP"
                # Se falhar o regex, salvamos o texto cru no street para garantir
                data["street"] = full_text

    return data

def extract_zap_main_image(soup: BeautifulSoup) -> str | None:
    """
    Estratégia (ordem):
    1) meta og:image / twitter:image
    2) JSON-LD image
    3) __NEXT_DATA__ varrendo recursivo
    4) picture/source/srcset / img[src|srcset]
    5) regex no HTML
    """
    # 1) metas
    for sel in [
        ('meta[property="og:image"]', "content"),
        ('meta[name="twitter:image"]', "content"),
        ('meta[property="og:image:secure_url"]', "content"),
    ]:
        tag = soup.select_one(sel[0])
        if tag:
            u = (tag.get(sel[1]) or "").strip()
            if looks_like_image_url(u):
                return u

    # 2) JSON-LD
    ld = extract_from_jsonld(soup)
    if ld:
        u = deep_find_first_image(ld)
        if u and looks_like_image_url(u):
            return u

    # 3) NEXT_DATA
    nd = extract_from_next_data(soup)
    if nd:
        u = deep_find_first_image(nd)
        if u and looks_like_image_url(u):
            return u

    # 4) picture/source/srcset
    source = soup.select_one("picture source[srcset]")
    if source:
        best = pick_best_from_srcset(source.get("srcset", ""))
        if best and looks_like_image_url(best):
            return best

    img = soup.select_one("img[src], img[srcset]")
    if img:
        u = (img.get("src") or "").strip()
        if looks_like_image_url(u):
            return u
        best = pick_best_from_srcset(img.get("srcset", ""))
        if best and looks_like_image_url(best):
            return best

    # 5) regex no HTML
    html = str(soup)
    # pega URLs diretas de imagem
    candidates = re.findall(r"https?://[^\s\"'>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^\s\"'>]*)?", html, flags=re.IGNORECASE)
    candidates = [c for c in candidates if looks_like_image_url(c)]
    if candidates:
        return candidates[0]

    # tenta resizedimgs (mesmo sem extensão no final)
    candidates2 = re.findall(r"https?://resizedimgs\.[^\s\"'>]+", html, flags=re.IGNORECASE)
    candidates2 = [c for c in candidates2 if "action=" in c or "dimension=" in c]
    if candidates2:
        return candidates2[0]

    return None

def extract_title(soup: BeautifulSoup) -> str:
    # meta og:title costuma ser bom
    t = soup.select_one('meta[property="og:title"]')
    if t and t.get("content"):
        return t.get("content").strip()
    h1 = soup.find("h1")
    if h1:
        return h1.get_text(strip=True)
    if soup.title:
        return soup.title.get_text(strip=True)
    return ""

def extract_price(soup: BeautifulSoup) -> float:
    # tenta JSON-LD offers.price
    ld = extract_from_jsonld(soup)
    if ld:
        # pode ser dict, lista, etc
        def find_price(o):
            if isinstance(o, dict):
                if "offers" in o:
                    return find_price(o["offers"])
                if "price" in o:
                    try:
                        return float(str(o["price"]).replace(".", "").replace(",", "."))
                    except Exception:
                        pass
                for v in o.values():
                    p = find_price(v)
                    if p:
                        return p
            if isinstance(o, list):
                for it in o:
                    p = find_price(it)
                    if p:
                        return p
            return 0.0
        p = find_price(ld)
        if p and p > 0:
            return float(p)

    # fallback: caça "R$"
    text = soup.get_text(" ", strip=True)
    m = re.search(r"R\$\s*([\d\.\,]+)", text)
    if m:
        return clean_number(m.group(1))
    return 0.0

def extract_basic_neighborhood(soup: BeautifulSoup) -> str:
    # tenta meta og:description (às vezes vem algo tipo "Cambui - Campinas")
    d = soup.select_one('meta[property="og:description"]')
    if d and d.get("content"):
        txt = d.get("content").strip()
        # heurística simples: pega antes de " - "
        parts = txt.split(" - ")
        if parts:
            return parts[0].strip()
    return ""

# ============================================================
# CORE
# ============================================================
# ... (MANTENHA OS IMPORTS E CONFIGURAÇÕES DO INÍCIO IGUAIS) ...

# ============================================================
# NOVOS HELPERS (Adicione ou substitua na seção HELPERS)
# ============================================================

def extract_details_from_html(soup: BeautifulSoup) -> dict:
    """
    Baseado nos prints:
    Procura por <p> com textos "Metragem", "Quartos", "Banheiros", "Vagas".
    O valor numérico está geralmente em uma tag <p> irmã ou dentro de uma div próxima
    com classes indicando negrito (font-bold).
    """
    data = {
        "usable_areas": 0,
        "bedrooms": 0,
        "bathrooms": 0,
        "parking_spaces": 0
    }
    
    # Mapeamento: Texto na tela -> Chave no nosso dict
    mappings = {
        "Metragem": "usable_areas",
        "Quartos": "bedrooms",
        "Banheiros": "bathrooms",
        "Vagas": "parking_spaces"
    }

    # Estratégia: Encontrar o texto do label, subir para o pai container, e buscar o valor negrito
    for label_text, json_key in mappings.items():
        # Procura parágrafo que contenha exatamente o texto ou comece com ele
        # O re.IGNORECASE ajuda se mudarem para "quartos" minúsculo
        label_tag = soup.find("p", string=re.compile(rf"^\s*{label_text}\s*$", re.IGNORECASE))
        
        if label_tag:
            # Nos prints, a estrutura é:
            # <li>
            #   <div class="flex flex-col ...">
            #      <p>Label (Metragem)</p>
            #      <div class="flex items-center ...">
            #         <svg>...</svg>
            #         <p class="... font-bold ...">Valor (67 m²)</p>
            #      </div>
            #   </div>
            # </li>
            
            # Vamos subir um nível para o <div> pai (flex-col)
            parent_div = label_tag.find_parent("div")
            
            if parent_div:
                # Agora buscamos qualquer <p> dentro desse pai que tenha "font-bold" na classe
                # ou que simplesmente seja o próximo <p> depois do label
                value_tag = parent_div.find("p", class_=lambda c: c and "font-bold" in c)
                
                if value_tag:
                    raw_text = value_tag.get_text(strip=True)
                    # Limpa "m²" e outros caracteres, convertendo para float/int
                    val = clean_number(raw_text)
                    data[json_key] = int(val) if json_key != "usable_areas" else float(val)

    return data

# ============================================================
# CORE ATUALIZADO
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

        # ID Externo
        m = re.search(r"/imovel/(\d+)", url)
        ext_id = m.group(1) if m else "0"

        # --- EXTRAÇÕES ---
        title = extract_title(soup)
        img_url = extract_zap_main_image(soup)
        price = extract_price(soup)
        
        # Detalhes numéricos (quartos, áreas, etc)
        details = extract_details_from_html(soup) 
        
        # NOVA EXTRAÇÃO DE LOCALIZAÇÃO (Substitui o extract_basic_neighborhood antigo)
        loc_data = extract_complete_address_info(soup)
        
        print(f"   📍 Localização: {loc_data['neighborhood']} | {loc_data['city']}") 
        print(f"   🏠 Detalhes: {details} | Preço: {price}")

        # ---------------------------------------------------------
        # PAYLOAD
        # ---------------------------------------------------------
        payload = {
            "dedupe_key": f"zap_{ext_id}",
            "portal": "zap",
            "external_id": ext_id,
            "url": url,
            "title": title,
            "main_image_url": img_url,
            "price": float(price) if price else 0.0,
            
            # Dados numéricos
            "area_m2": float(details["usable_areas"]),
            "bedrooms": int(details["bedrooms"]),
            "bathrooms": int(details["bathrooms"]),
            "parking": int(details["parking_spaces"]),
            
            # --- DADOS DE LOCALIZAÇÃO ATUALIZADOS ---
            "street": loc_data["street"],          # Se tiver coluna 'street' ou 'address' no seu banco
            "neighborhood": loc_data["neighborhood"],
            "city": loc_data["city"],
            "state": loc_data["state"],
            # ----------------------------------------

            "last_seen_at": datetime.now(TZ).isoformat(),
            
            "full_data": {
                "extracted_method": "zap_html_rescue_v3_location",
                "raw_details": details,
                "raw_location": loc_data
            },
        }

        # ... (O RESTO DO CÓDIGO DE UPSERT/INSERT CONTINUA IGUAL) ...
        # Apenas certifique-se que sua tabela 'listings' tem as colunas
        # neighborhood, city e state. Se não tiver 'street', remova do payload acima.

        existing = (
            supabase.table("listings")
            .select("id, main_image_url")
            .eq("dedupe_key", payload["dedupe_key"])
            .execute()
        )
        
        # ... (Mantém a lógica de Upsert igual ao anterior) ...
        if existing.data and len(existing.data) > 0:
            current = existing.data[0]
            payload_update = payload.copy()
            if not payload_update.get("main_image_url") and current.get("main_image_url"):
                payload_update["main_image_url"] = current["main_image_url"]
            
            supabase.table("listings").update(payload_update).eq("dedupe_key", payload["dedupe_key"]).execute()
            print(f"   🔄 Imóvel {ext_id} ATUALIZADO.")
        else:
            payload["published_at"] = published_at_from_log
            payload["first_seen_at"] = datetime.now(TZ).isoformat()
            supabase.table("listings").insert(payload).execute()
            print(f"   💾 Imóvel {ext_id} INSERIDO.")

    except Exception as e:
        print(f"🚨 Erro no link {url}: {e}")

# ... (Main continua igual) ...

# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    print(f"🚀 Iniciando resgate completo para {len(items_to_scrape)} imóveis (ZAP)...")
    for ts_log, link in items_to_scrape:
        processar_html_zap(ts_log, link)
        time.sleep(2)
