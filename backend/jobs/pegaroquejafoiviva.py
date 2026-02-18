import os
import requests
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client, Client

# --- CONFIGURAÇÕES ---
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
}

links_to_scrape = [
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-jardim-garcia-campinas-com-garagem-70m2-venda-RS279360-id-2870743197/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-swiss-park-campinas-com-garagem-350m2-venda-RS2399500-id-2870741444/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-vila-hollandia-campinas-com-garagem-266m2-venda-RS1989580-id-2870738147/",
    "https://www.vivareal.com.br/imovel/casa-4-quartos-vila-nova-sao-jose-campinas-com-garagem-250m2-venda-RS699750-id-2870743786/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-4-quartos-swiss-park-campinas-com-garagem-320m2-venda-RS2989790-id-2870737347/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-residencial-candido-ferreira-sousas-campinas-com-garagem-213m2-venda-RS1198310-id-2870741325/",
    "https://www.vivareal.com.br/imovel/apartamento-4-quartos-cambui-campinas-com-garagem-235m2-venda-RS1849050-id-2870737662/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-parque-industrial-campinas-com-garagem-84m2-venda-RS920000-id-2870759903/"
]

MESES = {
    "janeiro": 1, "fevereiro": 2, "março": 3, "marco": 3, "abril": 4, "maio": 5, "junho": 6,
    "julho": 7, "agosto": 8, "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12
}

def clean_number(text):
    """Extrai apenas números de uma string e retorna FLOAT (ex: '84 m²' -> 84.0)."""
    if not text:
        return 0.0
    nums = re.sub(r"[^0-9,]", "", text)
    return float(nums.replace(",", ".")) if nums else 0.0

def extrair_feature_por_label(soup_obj, labels_possiveis):
    """Busca o valor numérico baseado no texto do rótulo (Label)."""
    for label in labels_possiveis:
        label_tag = soup_obj.find("p", string=re.compile(rf"^\s*{label}\s*$", re.IGNORECASE))
        if label_tag:
            container_pai = label_tag.find_parent("div")
            if container_pai:
                valor_tag = container_pai.find("p", class_=re.compile("font-bold"))
                if valor_tag:
                    texto_valor = valor_tag.get_text(strip=True)
                    return clean_number(texto_valor)
    return 0.0

def extrair_data_criacao(soup):
    """
    Pega a data do card no VivaReal pelo span data-testid="listing-created-date".
    Retorna ISO string.
    """
    try:
        span = soup.find("span", {"data-testid": "listing-created-date"})
        if not span:
            return None
        texto = span.get_text(strip=True).lower()
        match = re.search(r"(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})", texto)
        if match:
            dia, mes_nome, ano = match.groups()
            mes_num = MESES.get(mes_nome, 1)
            # mantém padrão "00:00:00" local (SP)
            dt = datetime(int(ano), mes_num, int(dia), 0, 0, 0, tzinfo=TZ)
            return dt.isoformat()
    except Exception:
        pass
    return None

def pick_best_from_srcset(srcset: str):
    """
    Recebe um srcset e retorna a URL com maior 'w'.
    Ex: "url 340w, url 768w, url 1080w" -> pega a de 1080w.
    """
    if not srcset:
        return None

    best_url = None 
    contributes_best = -1
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

def extract_vivareal_main_image(soup: BeautifulSoup):
    """
    Corrige o problema do print:
    - o <img data-testid="carousel-item-image"> pode NÃO ter src
    - a URL real está em <picture><source srcset="...">
    """
    img = soup.select_one('img[data-testid="carousel-item-image"], img.carousel-photos--img')
    if img:
        # 1) src direto ou variações comuns
        for attr in ("src", "data-src", "data-lazy", "data-original", "data-image"):
            val = img.get(attr)
            if val and val.startswith("http"):
                return val

        # 2) srcset no img
        best = pick_best_from_srcset(img.get("srcset", ""))
        if best:
            return best

        # 3) source[srcset] dentro do picture pai
        pic = img.find_parent("picture")
        if pic:
            sources = pic.find_all("source", srcset=True)
            # prioriza webp
            sources = sorted(sources, key=lambda s: 0 if "webp" in (s.get("type") or "") else 1)
            for s in sources:
                best = pick_best_from_srcset(s.get("srcset", ""))
                if best:
                    return best

    # 3b) fallback: qualquer picture/source no doc
    first_source = soup.select_one("picture source[srcset]")
    if first_source:
        best = pick_best_from_srcset(first_source.get("srcset", ""))
        if best:
            return best

    # 4) fallback final: caça resizedimgs no HTML
    html = str(soup)
    candidates = re.findall(r"https://resizedimgs\.vivareal\.com/img/[^\s\"'>]+", html)
    if candidates:
        # tenta pegar a maior dimensão
        def score(u: str) -> int:
            m = re.search(r"dimension=(\d+)x(\d+)", u)
            if m:
                return int(m.group(1)) * int(m.group(2))
            return 0
        candidates.sort(key=score, reverse=True)
        return candidates[0]

    return None

def processar_html_viva_real(url):
    print(f"\n🌍 Acessando: {url}")
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        if resp.status_code == 404:
            print("❌ 404: Imóvel não existe mais.")
            return
        if resp.status_code >= 400:
            print(f"❌ HTTP {resp.status_code}")
            return

        soup = BeautifulSoup(resp.content, "html.parser")

        match_id = re.search(r"-id-(\d+)", url)
        ext_id = match_id.group(1) if match_id else "0"

        # 1) DATA (usada só no INSERT; no UPDATE a gente preserva published_at do banco)
        data_criacao = extrair_data_criacao(soup)
        if not data_criacao:
            data_criacao = datetime.now(TZ).isoformat()
            print("   ⚠️ Data não encontrada, usando 'agora'.")
        else:
            print(f"   📅 Data: {data_criacao}")

        # 2) TÍTULO
        title_elem = soup.find("h1", class_=re.compile("title"))
        title = title_elem.get_text(strip=True) if title_elem else ""

        # 3) IMAGEM (corrigido: pega de source/srcset quando não existe src no img)
        img_url = extract_vivareal_main_image(soup)
        print(f"   🖼️ img_url = {img_url}")

        # 4) PREÇO
        price = 0.0
        price_elem = soup.find("h3", class_=re.compile("price-info")) or soup.find("div", {"data-testid": "price-value"})
        if price_elem:
            price = clean_number(price_elem.get_text())

        # fallback: tenta pegar do alt do img (quando tiver)
        img_for_alt = soup.select_one('img[data-testid="carousel-item-image"], img.carousel-photos--img')
        if price == 0.0 and img_for_alt:
            alt_text = img_for_alt.get("alt", "")
            if "R$" in alt_text:
                match_price = re.search(r"R\$\s*([\d\.,]+)", alt_text)
                if match_price:
                    price = clean_number(match_price.group(1))
                    print(f"   💰 Preço recuperado pelo ALT da imagem: {price}")

        if price == 0.0 and "R$" in title:
            match_price = re.findall(r"R\$\s*([\d\.,]+)", title)
            if match_price:
                price = clean_number(match_price[-1])

        # 5) ENDEREÇO
        # 5) ENDEREÇO (Lógica Atualizada baseada na imagem)
        address_elem = soup.find("p", {"data-testid": "location-address"})
        full_address = address_elem.get_text(strip=True) if address_elem else ""
        
        # Variáveis padrão
        street = ""
        neighborhood = ""
        city = "Campinas" # Valor padrão caso falhe
        state = "SP"

        if full_address:
            # Divide pelos traços " - "
            # Ex: ['Rua Castelnuovo, 74', 'Jardim Garcia, Campinas', 'SP']
            parts = [p.strip() for p in full_address.split("-")]

            # O último pedaço geralmente é o Estado (SP)
            if len(parts) > 0:
                state = parts[-1]

            # O penúltimo pedaço geralmente contém "Bairro, Cidade"
            if len(parts) >= 2:
                middle_part = parts[-2] # Ex: "Jardim Garcia, Campinas"
                
                if "," in middle_part:
                    # Se tem vírgula, o formato é "Bairro, Cidade"
                    mp_split = [x.strip() for x in middle_part.split(",")]
                    city = mp_split[-1]         # Campinas
                    neighborhood = mp_split[0]  # Jardim Garcia
                else:
                    # Se não tem vírgula, assume que é só o Bairro ou Cidade
                    neighborhood = middle_part

            # Se tiver 3 partes ou mais, a primeira é a Rua/Número
            if len(parts) >= 3:
                street = parts[0]
            
            # Caso especial: Se só tiver 2 partes (Ex: "Jardim Garcia, Campinas - SP")
            # A rua fica vazia, e pegamos bairro/cidade da primeira parte
            if len(parts) == 2:
                first_part = parts[0]
                if "," in first_part:
                    fp_split = [x.strip() for x in first_part.split(",")]
                    city = fp_split[-1]
                    neighborhood = fp_split[0]
                else:
                    neighborhood = first_part

        print(f"   📍 Endereço: {street} | Bairro: {neighborhood} | Cidade: {city}")

        # 6) FEATURES
        area = extrair_feature_por_label(soup, ["Metragem", "Área", "Área útil"])
        quartos = extrair_feature_por_label(soup, ["Quartos", "Dormitórios"])
        banheiros = extrair_feature_por_label(soup, ["Banheiros", "Banhos"])
        vagas = extrair_feature_por_label(soup, ["Vagas", "Garagem"])

        print(f"   📐 Detalhes: {area}m² | {quartos} quartos | {banheiros} banhos | {vagas} vagas")

        payload = {
            "dedupe_key": f"vivareal_{ext_id}",
            "portal": "vivareal",
            "external_id": ext_id,
            "url": url,
            "title": title,
            "main_image_url": img_url,  # <-- aqui
            "price": price,
            "area_m2": area,
            "bedrooms": int(quartos),
            "bathrooms": int(banheiros),
            "parking": int(vagas),
            "city": "Campinas",
            "neighborhood": neighborhood,
            "state": "SP",
            "published_at": data_criacao,  # INSERT usa isso; UPDATE preserva o do banco
            "last_seen_at": datetime.now(TZ).isoformat(),
            "full_data": {"extracted_method": "html_rescue_v8_image_srcset_preserve_published"},
        }

        # ============================================================
        # UPSERT MANUAL (UPDATE preserva published_at e nunca apaga imagem)
        # ============================================================
        try:
            existing = (
                supabase.table("listings")
                .select("id, published_at, first_seen_at, main_image_url")
                .eq("dedupe_key", payload["dedupe_key"])
                .execute()
            )

            if existing.data and len(existing.data) > 0:
                current = existing.data[0]

                payload_update = payload.copy()

                # 1) NÃO atualizar published_at
                payload_update.pop("published_at", None)

                # 2) NÃO atualizar first_seen_at
                payload_update.pop("first_seen_at", None)

                # 3) NÃO apagar imagem com None: se não achou agora, mantém a do banco
                if not payload_update.get("main_image_url"):
                    if current.get("main_image_url"):
                        payload_update["main_image_url"] = current["main_image_url"]
                    else:
                        payload_update.pop("main_image_url", None)

                supabase.table("listings").update(payload_update).eq("dedupe_key", payload["dedupe_key"]).execute()
                print(f"   🔄 Imóvel ID {ext_id} atualizado! (published_at preservado)")

            else:
                payload["first_seen_at"] = datetime.now(TZ).isoformat()
                supabase.table("listings").insert(payload).execute()
                print(f"   💾 Imóvel ID {ext_id} inserido!")

            # Debug: confirma o que ficou salvo no banco
            check = (
                supabase.table("listings")
                .select("dedupe_key, published_at, main_image_url")
                .eq("dedupe_key", payload["dedupe_key"])
                .execute()
            )
            print("   ✅ banco:", check.data)

        except Exception as db_err:
            print(f"   🚨 Erro ao salvar no banco: {db_err}")

    except Exception as e:
        print(f"🚨 Erro no link {url}: {e}")

if __name__ == "__main__":
    print(f"🚀 Iniciando resgate completo para {len(links_to_scrape)} imóveis...")
    for link in links_to_scrape:
        processar_html_viva_real(link)
        time.sleep(2)
