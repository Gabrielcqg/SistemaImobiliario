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

# Tabela correta
TABLE_NAME = "listings"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
}

links_to_scrape = [
    "https://www.vivareal.com.br/imovel/casa-de-condominio-4-quartos-swiss-park-campinas-com-garagem-320m2-venda-RS2989790-id-2870737347/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-vila-hollandia-campinas-com-garagem-266m2-venda-RS1989580-id-2870738147/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-swiss-park-campinas-com-garagem-350m2-venda-RS2399500-id-2870741444/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-parque-industrial-campinas-com-garagem-84m2-venda-RS920000-id-2870759903/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-jardim-garcia-campinas-com-garagem-70m2-venda-RS279360-id-2870743197/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-residencial-candido-ferreira-sousas-campinas-com-garagem-213m2-venda-RS1198310-id-2870741325/",
    "https://www.vivareal.com.br/imovel/casa-4-quartos-vila-nova-sao-jose-campinas-com-garagem-250m2-venda-RS699750-id-2870743786/",
    "https://www.vivareal.com.br/imovel/apartamento-4-quartos-cambui-campinas-com-garagem-235m2-venda-RS1849050-id-2870737662/",
    "https://www.vivareal.com.br/imovel/casa-2-quartos-cidade-jardim-campinas-com-garagem-221m2-venda-RS477000-id-2870191807/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-taquaral-campinas-com-garagem-67m2-venda-RS880000-id-2870163216/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-taquaral-campinas-com-garagem-67m2-venda-RS1055000-id-2870163892/",
    "https://www.vivareal.com.br/imovel/casa-8-quartos-parque-taquaral-campinas-com-garagem-533m2-venda-RS15000000-id-2870086765/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-caminhos-de-san-conrado-sousas-campinas-com-garagem-110m2-venda-RS2155000-id-2869778711/",
    "https://www.vivareal.com.br/imovel/sala-comercial-cambui-campinas-com-garagem-65m2-venda-RS700000-id-2869762070/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-5-quartos-sitios-de-recreio-gramado-campinas-com-garagem-1130m2-venda-RS12500000-id-2869761663/",
    "https://www.vivareal.com.br/imovel/casa-2-quartos-barao-geraldo-campinas-com-garagem-160m2-venda-RS750000-id-2869604431/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-vila-brandina-campinas-com-garagem-125m2-venda-RS1390000-id-2869579544/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-cambui-campinas-com-garagem-160m2-venda-RS1800000-id-2869579074/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-tijuco-das-telhas-campinas-com-garagem-346m2-venda-RS1600000-id-2869578213/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-bosque-campinas-com-garagem-98m2-venda-RS482446-id-2869573645/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-cambui-campinas-com-garagem-187m2-venda-RS518136-id-2869576343/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-rossin-campinas-39m2-venda-RS129948-id-2869578691/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-novo-maracana-campinas-47m2-venda-RS132970-id-2869578690/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-novo-maracana-campinas-47m2-venda-RS129344-id-2869578781/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-do-lago-campinas-com-garagem-45m2-venda-RS260000-id-2869576429/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-notre-dame-campinas-com-garagem-43m2-venda-RS405000-id-2869578381/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-chacara-sao-rafael-campinas-com-garagem-360m2-venda-RS3400000-id-2869573859/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-loteamento-parque-sao-martinho-campinas-com-garagem-49m2-venda-RS229000-id-2869569801/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-jardim-planalto-campinas-com-garagem-105m2-venda-RS1290000-id-2869568721/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-jardim-novo-campos-eliseos-campinas-com-garagem-240m2-venda-RS550000-id-2869571980/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-cambui-campinas-com-garagem-74m2-venda-RS1590000-id-2869571202/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-4-quartos-tijuco-das-telhas-campinas-com-garagem-300m2-venda-RS1730000-id-2869571878/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-taquaral-campinas-com-garagem-98m2-venda-RS1180000-id-2869568385/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-4-quartos-parque-alto-taquaral-campinas-com-garagem-240m2-venda-RS1850000-id-2869532793/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-cambui-campinas-com-garagem-178m2-venda-RS3200000-id-2869493211/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-nova-campinas-campinas-com-garagem-48m2-venda-RS900000-id-2869493795/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-sitios-de-recreio-gramado-campinas-com-garagem-220m2-venda-RS1590000-id-2869492600/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-taquaral-campinas-com-garagem-67m2-venda-RS980000-id-2869492105/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-parque-da-hipica-campinas-com-garagem-250m2-venda-RS1900000-id-2869491137/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-cambui-campinas-com-garagem-61m2-venda-RS620000-id-2869419283/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-1-quartos-caminhos-de-san-conrado-sousas-campinas-com-garagem-200m2-venda-RS980000-id-2869417885/",
    "https://www.vivareal.com.br/imovel/2869267375",
    "https://www.vivareal.com.br/imovel/2869256729",
    "https://www.vivareal.com.br/imovel/2869256445",
    "https://www.vivareal.com.br/imovel/2869187122",
    "https://www.vivareal.com.br/imovel/2869185353",
    "https://www.vivareal.com.br/imovel/2869181837"
]

MESES = {
    "janeiro": 1, "fevereiro": 2, "março": 3, "marco": 3, "abril": 4, "maio": 5, "junho": 6,
    "julho": 7, "agosto": 8, "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12
}

def clean_number(text):
    if not text:
        return 0.0
    nums = re.sub(r"[^0-9,]", "", text)
    return float(nums.replace(",", ".")) if nums else 0.0

def extrair_feature_por_label(soup_obj, labels_possiveis):
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
    try:
        span = soup.find("span", {"data-testid": "listing-created-date"})
        if not span:
            return None
        texto = span.get_text(strip=True).lower()
        match = re.search(r"(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})", texto)
        if match:
            dia, mes_nome, ano = match.groups()
            mes_num = MESES.get(mes_nome, 1)
            dt = datetime(int(ano), mes_num, int(dia), 0, 0, 0, tzinfo=TZ)
            return dt.isoformat()
    except Exception:
        pass
    return None

def pick_best_from_srcset(srcset: str):
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

def extract_vivareal_main_image(soup: BeautifulSoup):
    img = soup.select_one('img[data-testid="carousel-item-image"], img.carousel-photos--img')
    if img:
        for attr in ("src", "data-src", "data-lazy", "data-original", "data-image"):
            val = img.get(attr)
            if val and val.startswith("http"):
                return val

        best = pick_best_from_srcset(img.get("srcset", ""))
        if best:
            return best

        pic = img.find_parent("picture")
        if pic:
            sources = pic.find_all("source", srcset=True)
            sources = sorted(sources, key=lambda s: 0 if "webp" in (s.get("type") or "") else 1)
            for s in sources:
                best = pick_best_from_srcset(s.get("srcset", ""))
                if best:
                    return best

    first_source = soup.select_one("picture source[srcset]")
    if first_source:
        best = pick_best_from_srcset(first_source.get("srcset", ""))
        if best:
            return best

    html = str(soup)
    candidates = re.findall(r"https://resizedimgs\.vivareal\.com/img/[^\s\"'>]+", html)
    if candidates:
        def score(u: str) -> int:
            m = re.search(r"dimension=(\d+)x(\d+)", u)
            if m:
                return int(m.group(1)) * int(m.group(2))
            return 0
        candidates.sort(key=score, reverse=True)
        return candidates[0]

    return None

def extrair_tipo_imovel(title, url):
    """Extrai o tipo de propriedade mapeado estritamente para o banco de dados (apartment, house, other)."""
    title_lower = title.lower() if title else ""
    url_lower = url.lower()

    # Verifica se é apartamento
    if "apartamento" in title_lower or "apartamento" in url_lower:
        return "apartment"
    
    # Verifica se é casa (inclui casa, casa de condomínio, sobrado)
    if "casa" in title_lower or "casa" in url_lower:
        return "house"
    
    # Qualquer outro tipo (sala comercial, terreno, galpão, cobertura, etc)
    return "other"

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

        match_id = re.search(r"(?:-id-|/imovel/)(\d+)", url)
        ext_id = match_id.group(1) if match_id else "0"

        data_criacao = extrair_data_criacao(soup)
        if not data_criacao:
            data_criacao = datetime.now(TZ).isoformat()
            print("   ⚠️ Data não encontrada, usando 'agora'.")
        else:
            print(f"   📅 Data: {data_criacao}")

        title_elem = soup.find("h1", class_=re.compile("title"))
        title = title_elem.get_text(strip=True) if title_elem else ""

        img_url = extract_vivareal_main_image(soup)
        print(f"   🖼️ img_url = {img_url}")

        price = 0.0
        price_elem = soup.find("h3", class_=re.compile("price-info")) or soup.find("div", {"data-testid": "price-value"})
        if price_elem:
            price = clean_number(price_elem.get_text())

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

        address_elem = soup.find("p", {"data-testid": "location-address"})
        full_address = address_elem.get_text(strip=True) if address_elem else ""
        
        street = ""
        neighborhood = ""
        city = "Campinas" 
        state = "SP"

        if full_address:
            parts = [p.strip() for p in full_address.split("-")]

            if len(parts) > 0:
                state = parts[-1]

            if len(parts) >= 2:
                middle_part = parts[-2]
                
                if "," in middle_part:
                    mp_split = [x.strip() for x in middle_part.split(",")]
                    city = mp_split[-1]
                    neighborhood = mp_split[0]
                else:
                    neighborhood = middle_part

            if len(parts) >= 3:
                street = parts[0]
            
            if len(parts) == 2:
                first_part = parts[0]
                if "," in first_part:
                    fp_split = [x.strip() for x in first_part.split(",")]
                    city = fp_split[-1]
                    neighborhood = fp_split[0]
                else:
                    neighborhood = first_part

        print(f"   📍 Endereço: {street} | Bairro: {neighborhood} | Cidade: {city}")

        area = extrair_feature_por_label(soup, ["Metragem", "Área", "Área útil"])
        quartos = extrair_feature_por_label(soup, ["Quartos", "Dormitórios"])
        banheiros = extrair_feature_por_label(soup, ["Banheiros", "Banhos"])
        vagas = extrair_feature_por_label(soup, ["Vagas", "Garagem"])
        
        # Chamando a função atualizada
        property_type = extrair_tipo_imovel(title, url)

        print(f"   📐 Detalhes: {area}m² | {quartos} quartos | {banheiros} banhos | {vagas} vagas")
        print(f"   🏠 Tipo do Imóvel Formatado: {property_type}")

        payload = {
            "dedupe_key": f"vivareal_{ext_id}",
            "portal": "vivareal",
            "external_id": ext_id,
            "url": url,
            "title": title,
            "property_type": property_type,
            "main_image_url": img_url,
            "price": price,
            "area_m2": area,
            "bedrooms": int(quartos),
            "bathrooms": int(banheiros),
            "parking": int(vagas),
            "city": city,
            "neighborhood": neighborhood,
            "state": state,
            "published_at": data_criacao,
            "last_seen_at": datetime.now(TZ).isoformat(),
            "full_data": {"extracted_method": "html_rescue_v8_image_srcset_preserve_published"},
        }

        try:
            # Buscar pela constraint correta
            existing = (
                supabase.table(TABLE_NAME)
                .select("id, published_at, first_seen_at, main_image_url")
                .eq("portal", "vivareal")
                .eq("external_id", ext_id)
                .execute()
            )

            if existing.data and len(existing.data) > 0:
                current = existing.data[0]
                payload_update = payload.copy()

                payload_update.pop("published_at", None)
                payload_update.pop("first_seen_at", None)

                if not payload_update.get("main_image_url"):
                    if current.get("main_image_url"):
                        payload_update["main_image_url"] = current["main_image_url"]
                    else:
                        payload_update.pop("main_image_url", None)

                # Atualiza usando o ID da tabela
                supabase.table(TABLE_NAME).update(payload_update).eq("id", current["id"]).execute()
                print(f"   🔄 Imóvel ID {ext_id} atualizado! (property_type preenchido, datas preservadas)")

            else:
                payload["first_seen_at"] = datetime.now(TZ).isoformat()
                supabase.table(TABLE_NAME).insert(payload).execute()
                print(f"   💾 Imóvel ID {ext_id} inserido com sucesso!")

        except Exception as db_err:
            print(f"   🚨 Erro ao salvar no banco: {db_err}")

    except Exception as e:
        print(f"🚨 Erro no link {url}: {e}")

if __name__ == "__main__":
    print(f"🚀 Iniciando resgate completo para {len(links_to_scrape)} imóveis na tabela {TABLE_NAME}...")
    for link in links_to_scrape:
        processar_html_viva_real(link)
        time.sleep(2)