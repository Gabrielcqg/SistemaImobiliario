import os
import requests
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

# --- TIMEZONE (Brasil/SP) ---
TZ = ZoneInfo("America/Sao_Paulo")

def parse_iso(dt_str: str):
    """Parse ISO 8601 (incluindo 'Z') -> datetime aware ou None."""
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except Exception:
        return None

def build_card_url(item: dict, ext_id: str) -> str:
    """
    Tenta achar a URL real no JSON (link/fullUriFragments); fallback pro padrão.
    """
    if not isinstance(item, dict):
        return f"https://www.vivareal.com.br/imovel/{ext_id}"

    listing = item.get("listing", {}) or {}

    # 1) Alguns payloads trazem link no nível do item ou dentro do listing
    for obj in (item.get("link"), listing.get("link")):
        if isinstance(obj, dict):
            href = obj.get("href") or obj.get("url") or obj.get("uri")
            if isinstance(href, str) and href:
                if href.startswith("/"):
                    return "https://www.vivareal.com.br" + href
                if href.startswith("http"):
                    return href

    # 2) fullUriFragments (às vezes vem string ou lista)
    fuf = item.get("fullUriFragments") or listing.get("fullUriFragments")
    if isinstance(fuf, str) and fuf.strip():
        frag = fuf.strip()
        if frag.startswith("/"):
            return "https://www.vivareal.com.br" + frag
        if frag.startswith("http"):
            return frag
    if isinstance(fuf, list) and fuf:
        for frag in fuf:
            if isinstance(frag, str) and frag.strip():
                frag = frag.strip()
                if frag.startswith("/"):
                    return "https://www.vivareal.com.br" + frag
                if frag.startswith("http"):
                    return frag

    # fallback
    return f"https://www.vivareal.com.br/imovel/{ext_id}"

def detect_below_market(listing: dict):
    """
    Heurística para detectar o badge 'Preço abaixo do mercado'.
    A gente NÃO assume um stamp específico; a ideia é:
      - checar stamps por palavras-chave
      - checar priceSuggestion (se existir) por chaves/status comuns
    Retorna: (bool, reason_str)
    """
    stamps = listing.get("stamps") or []
    if not isinstance(stamps, list):
        stamps = []

    # 1) procurar indícios em stamps
    for s in stamps:
        if isinstance(s, str):
            up = s.upper()
            if ("BELOW" in up) or ("UNDER" in up) or ("ABAIXO" in up) or ("LOW_PRICE" in up) or ("UNDER_MARKET" in up):
                return True, f"stamp:{s}"

    # 2) procurar indícios em priceSuggestion (se vier)
    ps = listing.get("priceSuggestion")
    if isinstance(ps, dict) and ps:
        # flags comuns (variantes possíveis)
        for key in ("belowMarket", "isBelowMarket", "underMarket", "priceBelowMarket", "below_market"):
            if ps.get(key) is True:
                return True, f"priceSuggestion.{key}=true"

        # status/classificação
        status = ps.get("status") or ps.get("classification") or ps.get("label") or ps.get("tag")
        if isinstance(status, str):
            sup = status.upper()
            if ("BELOW" in sup) or ("ABAIXO" in sup) or ("UNDER" in sup):
                return True, f"priceSuggestion.status:{status}"

    return False, None

def summarize_price_suggestion(ps):
    """Resumo curto pra print (não poluir console)."""
    if not isinstance(ps, dict) or not ps:
        return None
    keys = list(ps.keys())
    # mostra no máximo 8 chaves
    return {"keys": keys[:8], "status": ps.get("status") or ps.get("classification") or ps.get("label")}

# --- CONFIGURAÇÕES SUPABASE ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("❌ SUPABASE_URL e/ou SUPABASE_KEY não encontrados no .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- CONFIGURAÇÕES VIVAREAL (GLUE API) ---
URL = "https://glue-api.vivareal.com/v4/listings?user=aeaa0c71-4ec4-4d43-a17a-84e5acac5e45&portal=VIVAREAL&includeFields=fullUriFragments%2Cpage%2Csearch%28result%28listings%28listing%28expansionType%2CcontractType%2ClistingsCount%2CpropertyDevelopers%2CsourceId%2CdisplayAddressType%2Camenities%2CusableAreas%2CconstructionStatus%2ClistingType%2Cdescription%2Ctitle%2Cstamps%2CcreatedAt%2Cfloors%2CunitTypes%2CnonActivationReason%2CproviderId%2CpropertyType%2CunitSubTypes%2CunitsOnTheFloor%2ClegacyId%2Cid%2Cportal%2Cportals%2CunitFloor%2CparkingSpaces%2CupdatedAt%2Caddress%2Csuites%2CpublicationType%2CexternalId%2Cbathrooms%2CusageTypes%2CtotalAreas%2CadvertiserId%2CadvertiserContact%2CwhatsappNumber%2Cbedrooms%2CacceptExchange%2CpricingInfos%2CshowPrice%2Cresale%2Cbuildings%2CcapacityLimit%2Cstatus%2CpriceSuggestion%2CcondominiumName%2Cmodality%2CenhancedDevelopment%29%2Caccount%28id%2Cname%2ClogoUrl%2ClicenseNumber%2CshowAddress%2ClegacyVivarealId%2ClegacyZapId%2CcreatedDate%2Ctier%2CtrustScore%2CtotalCountByFilter%2CtotalCountByAdvertiser%29%2Cmedias%2CaccountLink%2Clink%2Cchildren%28id%2CusableAreas%2CtotalAreas%2Cbedrooms%2Cbathrooms%2CparkingSpaces%2CpricingInfos%29%29%29%2CtotalCount%29&categoryPage=RESULT&business=SALE&sort=MOST_RECENT&parentId=null&listingType=USED&__zt=mtc%3Adeduplication2023&addressCity=Campinas&addressLocationId=BR%3ESao+Paulo%3ENULL%3ECampinas&addressState=S%C3%A3o+Paulo&addressPointLat=-22.905082&addressPointLon=-47.061333&addressType=city&page=1&size=50&from=0&images=webp"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
    "x-domain": ".vivareal.com.br",
    "Referer": "https://www.vivareal.com.br/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
}

PRINT_FULL_REQUEST_URL_ON_START = True
SAMPLE_N = 10

def salvar_imovel_manual(imovel: dict):
    try:
        listing = imovel.get("listing", {}) or {}
        pricing = (listing.get("pricingInfos") or [{}])[0] or {}

        ext_id = str(listing.get("id"))
        url_card = build_card_url(imovel, ext_id)

        created_raw = listing.get("createdAt")
        updated_raw = listing.get("updatedAt")

        # --- badge abaixo do mercado (investigação) ---
        stamps = listing.get("stamps") or []
        price_suggestion = listing.get("priceSuggestion") if isinstance(listing.get("priceSuggestion"), dict) else {}
        below_market, below_reason = detect_below_market(listing)

        # --- LÓGICA DA IMAGEM BLINDADA ---
        medias = imovel.get("medias", []) or []
        image_url = None

        for media in medias:
            raw_url = (media.get("url") or "") if isinstance(media, dict) else ""
            media_type = (media.get("type") or "") if isinstance(media, dict) else ""

            if media_type == "IMAGE" and "youtube" not in raw_url.lower() and "youtu.be" not in raw_url.lower():
                image_url = (
                    raw_url.replace("{description}", "imovel")
                          .replace("{action}", "crop")
                          .replace("{width}", "800")
                          .replace("{height}", "600")
                )
                break

        now_iso = datetime.now(TZ).isoformat()

        # salva evidências em full_data (sem mudar schema agora)
        full_data = {
            "stamps": stamps,
            "priceSuggestion": price_suggestion,
            "below_market": below_market,
            "below_market_reason": below_reason,
        }

        payload = {
            "portal": "vivareal",
            "external_id": ext_id,
            "url": url_card,
            "main_image_url": image_url,
            "title": listing.get("title"),
            "price": pricing.get("price"),
            "city": (listing.get("address", {}) or {}).get("city"),
            "state": (listing.get("address", {}) or {}).get("stateAcronym"),
            "neighborhood": (listing.get("address", {}) or {}).get("neighborhood"),
            "area_m2": (listing.get("totalAreas") or [0])[0] if listing.get("totalAreas") else 0,
            "bedrooms": (listing.get("bedrooms") or [0])[0] if listing.get("bedrooms") else 0,
            "bathrooms": (listing.get("bathrooms") or [0])[0] if listing.get("bathrooms") else 0,
            "parking": (listing.get("parkingSpaces") or [0])[0] if listing.get("parkingSpaces") else 0,
            "condo_fee": pricing.get("monthlyCondoFee"),
            "iptu": pricing.get("yearlyIptu"),
            "last_seen_at": now_iso,
            "first_seen_at": now_iso,
            "published_at": created_raw,
            "updated_at_portal": updated_raw,
            "full_data": full_data,
        }

        # Debug do imóvel que está sendo salvo
        created_dt = parse_iso(created_raw)
        created_sp = created_dt.astimezone(TZ).strftime("%Y-%m-%d %H:%M:%S") if created_dt else None
        print(
            f"➡️ Salvando: id={ext_id} | createdAt={created_raw} (SP={created_sp}) | "
            f"below_market={below_market} ({below_reason}) | url={url_card}"
        )

        # Verifica e salva
        existe = supabase.table("listings").select("id").eq("external_id", ext_id).execute()

        if existe.data and len(existe.data) > 0:
            # --- UPDATE (first_seen/published não mudam) ---
            del payload["external_id"]
            del payload["published_at"]
            del payload["first_seen_at"]

            # não apaga imagem antiga se não encontrou uma nova
            if image_url is None and "main_image_url" in payload:
                del payload["main_image_url"]

            supabase.table("listings").update(payload).eq("external_id", ext_id).execute()
            print(f"🔄 Atualizado: {ext_id}")
        else:
            supabase.table("listings").insert(payload).execute()
            print(f"✅ Inserido: {ext_id}")

        return True

    except Exception as e:
        print(f"❌ Erro no imóvel { (imovel.get('listing', {}) or {}).get('id') }: {e}")
        return False

def executar_ciclo():
    inicio_req = time.time()

    # 1. Cria Run
    try:
        run_res = supabase.table("scrape_runs").insert({
            "status": "running",
            "city": "Campinas",
            "state": "SP"
        }).execute()
        run_id = run_res.data[0]["id"]
    except Exception as e:
        print(f"🚨 Erro crítico ao criar Run: {e}")
        return

    now_sp = datetime.now(TZ)
    hoje_sp = now_sp.date()

    print(f"\n[{now_sp.strftime('%H:%M:%S')}] 🔎 Buscando imóveis... (SP={now_sp.strftime('%Y-%m-%d %H:%M:%S')})")

    cards_collected = 0
    cards_upserted = 0
    status_code = 0
    bytes_recv = 0
    erro_msg = None

    try:
        if PRINT_FULL_REQUEST_URL_ON_START:
            print(f"🔗 Request URL (completa): {URL}")

        print(f"🔗 Request URL (len={len(URL)}): {URL[:220]}{'...' if len(URL) > 220 else ''}")

        response = requests.get(URL, headers=HEADERS, timeout=20)
        status_code = response.status_code
        bytes_recv = len(response.content) if response.content else 0

        print(f"🌐 HTTP {status_code} | bytes={bytes_recv}")

        if status_code == 200:
            data = response.json()
            listings = (data.get("search", {}) or {}).get("result", {}).get("listings", []) or []

            print(f"📦 Total de cards analisados (retornados pela API): {len(listings)}")

            created_list = []
            missing_created = 0
            below_market_count = 0

            for item in listings:
                listing = item.get("listing", {}) or {}
                created_raw = listing.get("createdAt")
                created_dt = parse_iso(created_raw)
                if created_dt:
                    created_list.append(created_dt)
                else:
                    missing_created += 1

                bm, _ = detect_below_market(listing)
                if bm:
                    below_market_count += 1

            print(f"🗓️ Cards com createdAt: {len(created_list)} | sem createdAt: {missing_created}")
            print(f"🏷️ Cards com 'Preço abaixo do mercado' (heurística): {below_market_count}")

            if created_list:
                newest = max(created_list).astimezone(TZ)
                oldest = min(created_list).astimezone(TZ)
                print(f"⏱️ createdAt (SP) mais novo: {newest.isoformat()}")
                print(f"⏱️ createdAt (SP) mais velho: {oldest.isoformat()}")

            sample_n = min(SAMPLE_N, len(listings))
            print(f"🔎 Amostra (primeiros {sample_n} cards):")
            for item in listings[:sample_n]:
                listing = item.get("listing", {}) or {}
                ext_id = str(listing.get("id"))
                created_raw = listing.get("createdAt")
                updated_raw = listing.get("updatedAt")
                url_card = build_card_url(item, ext_id)

                stamps = listing.get("stamps") or []
                ps = listing.get("priceSuggestion") if isinstance(listing.get("priceSuggestion"), dict) else {}
                ps_sum = summarize_price_suggestion(ps)
                bm, reason = detect_below_market(listing)

                created_dt = parse_iso(created_raw)
                created_sp_str = created_dt.astimezone(TZ).strftime("%Y-%m-%d %H:%M:%S") if created_dt else None

                print(
                    f" - id={ext_id} | createdAt={created_raw} (SP={created_sp_str}) | updatedAt={updated_raw} | "
                    f"below_market={bm} ({reason}) | stamps={stamps} | priceSuggestion={ps_sum} | url={url_card}"
                )

            # NOVOS HOJE (SP) considerando createdAt
            encontrados_hoje = []
            for item in listings:
                listing = item.get("listing", {}) or {}
                created_dt = parse_iso(listing.get("createdAt"))
                if created_dt and created_dt.astimezone(TZ).date() == hoje_sp:
                    encontrados_hoje.append(item)

            # comparação com critério antigo (startswith naive)
            hoje_str_naive = datetime.now().strftime("%Y-%m-%d")
            encontrados_hoje_startswith = [
                item for item in listings
                if (item.get("listing", {}) or {}).get("createdAt", "").startswith(hoje_str_naive)
            ]

            print(f"✅ Novos HOJE (SP): {len(encontrados_hoje)} | Novos HOJE (startswith naive): {len(encontrados_hoje_startswith)}")

            cards_collected = len(encontrados_hoje)

            if encontrados_hoje:
                print(f"🚨 {cards_collected} NOVOS ENCONTRADOS HOJE (SP)!")
                for imovel in encontrados_hoje:
                    listing = imovel.get("listing", {}) or {}
                    ext_id = str(listing.get("id"))
                    print(f"🔗 Card alvo: {build_card_url(imovel, ext_id)}")

                    if salvar_imovel_manual(imovel):
                        cards_upserted += 1
            else:
                print("Nada novo HOJE (SP).")

            supabase.table("scrape_runs").update({
                "status": "completed",
                "finished_at": datetime.now(TZ).isoformat()
            }).eq("id", run_id).execute()

        else:
            erro_msg = f"API Error: {status_code}"
            raise Exception(erro_msg)

    except Exception as e:
        erro_msg = str(e)
        print(f"Erro no ciclo: {e}")
        try:
            supabase.table("scrape_runs").update({"status": "failed"}).eq("id", run_id).execute()
        except:
            pass

    finally:
        duration = int((time.time() - inicio_req) * 1000)
        log_payload = {
            "run_id": run_id,
            "portal": "vivareal",
            "status_code": status_code,
            "duration_ms": duration,
            "bytes_received": bytes_recv,
            "cards_collected": cards_collected,
            "cards_upserted": cards_upserted,
            "render_used": False,
            "error_msg": erro_msg
        }
        try:
            supabase.table("scrape_logs").insert(log_payload).execute()
            print("📝 Log salvo.")
        except Exception as log_err:
            print(f"⚠️ Erro ao salvar log: {log_err}")

if __name__ == "__main__":
    first = True
    while True:
        PRINT_FULL_REQUEST_URL_ON_START = first
        first = False

        executar_ciclo()
        print("Aguardando 3 minutos...")
        time.sleep(180)
