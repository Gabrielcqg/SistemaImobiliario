import os
import requests
import time
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

# --- TIMEZONE (Brasil/SP) ---
TZ = ZoneInfo("America/Sao_Paulo")

# --- CONFIG DRY RUN ---
DRY_RUN = str(os.getenv("DRY_RUN", "0")).lower() in ("1", "true", "yes", "y", "on")

# --- JANELA "RECENTE" EM HORAS (últimas 32h) ---
RECENT_HOURS = int(os.getenv("RECENT_HOURS", "32"))

def parse_iso(dt_str: str):
    """Parse ISO 8601 (incluindo 'Z') -> datetime aware ou None."""
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except Exception:
        return None

def to_float_safe(x):
    """Tenta converter preço pra float. Se falhar, retorna None."""
    if x is None:
        return None
    try:
        if isinstance(x, (int, float)):
            return float(x)
        s = str(x).strip()
        if not s:
            return None
        s = s.replace("R$", "").replace(" ", "")
        # se tiver '.' e ',', assume formato BR ('.' milhar e ',' decimal)
        if "," in s and "." in s:
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", ".")
        return float(s)
    except Exception:
        return None

# ============================================================
# NOVA FUNÇÃO DE NORMALIZAÇÃO DE TIPO
# ============================================================
def get_normalized_type(unit_types: list) -> str:
    """
    Normaliza o tipo do imóvel baseado na lista 'unitTypes' do VivaReal.
    Regras:
    - HOME ou CONDOMINIUM -> 'house'
    - APARTMENT -> 'apartment'
    - COMMERCIAL -> 'commercial'
    - Outros -> 'other'
    """
    if not unit_types or not isinstance(unit_types, list):
        return "other"
    
    raw = str(unit_types[0]).upper().strip()

    if raw == "HOME":
        return "house"
    
    if raw == "CONDOMINIUM":
        return "house"
        
    if raw == "APARTMENT":
        return "apartment"
    
    if "COMMERCIAL" in raw:
        return "commercial"

    return "other"

def build_card_url(item: dict, ext_id: str) -> str:
    """Tenta achar a URL real no JSON (link/fullUriFragments); fallback pro padrão."""
    if not isinstance(item, dict):
        return f"https://www.vivareal.com.br/imovel/{ext_id}"

    listing = item.get("listing", {}) or {}

    for obj in (item.get("link"), listing.get("link")):
        if isinstance(obj, dict):
            href = obj.get("href") or obj.get("url") or obj.get("uri")
            if isinstance(href, str) and href:
                if href.startswith("/"):
                    return "https://www.vivareal.com.br" + href
                if href.startswith("http"):
                    return href

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

    return f"https://www.vivareal.com.br/imovel/{ext_id}"

def detect_below_market(listing: dict):
    """Heurística para detectar o badge 'Preço abaixo do mercado'."""
    stamps = listing.get("stamps") or []
    if not isinstance(stamps, list):
        stamps = []

    for s in stamps:
        if isinstance(s, str):
            up = s.upper()
            if any(x in up for x in ["BELOW", "UNDER", "ABAIXO", "LOW_PRICE", "UNDER_MARKET"]):
                return True, f"stamp:{s}"

    ps = listing.get("priceSuggestion")
    if isinstance(ps, dict) and ps:
        for key in ("belowMarket", "isBelowMarket", "underMarket", "priceBelowMarket", "below_market"):
            if ps.get(key) is True:
                return True, f"priceSuggestion.{key}=true"

        status = ps.get("status") or ps.get("classification") or ps.get("label") or ps.get("tag")
        if isinstance(status, str):
            sup = status.upper()
            if any(x in sup for x in ["BELOW", "ABAIXO", "UNDER"]):
                return True, f"priceSuggestion.status:{status}"

    return False, None

def summarize_price_suggestion(ps):
    """Resumo curto pra print (não poluir console)."""
    if not isinstance(ps, dict) or not ps:
        return None
    keys = list(ps.keys())
    return {"keys": keys[:8], "status": ps.get("status") or ps.get("classification") or ps.get("label")}

def extract_main_image_url(item: dict) -> str | None:
    """Extrai a melhor imagem principal possível (não quebra se não achar)."""
    try:
        medias = item.get("medias", []) or []
        if not isinstance(medias, list):
            medias = []

        for media in medias:
            if not isinstance(media, dict):
                continue
            raw_url = (media.get("url") or "") or ""
            media_type = (media.get("type") or "") or ""

            if media_type == "IMAGE" and raw_url and ("youtube" not in raw_url.lower()) and ("youtu.be" not in raw_url.lower()):
                return (
                    raw_url.replace("{description}", "imovel")
                          .replace("{action}", "crop")
                          .replace("{width}", "800")
                          .replace("{height}", "600")
                )

        # fallback genérico
        for media in medias:
            if isinstance(media, dict):
                for k in ("url", "src", "link", "href"):
                    v = media.get(k)
                    if isinstance(v, str) and v.startswith("http"):
                        return v
        return None
    except Exception:
        return None

def should_update(existing_row: dict, new_price_val, new_image_url: str | None, new_updated_at_portal: str | None) -> bool:
    """Define mudança relevante: price OR main_image_url OR updated_at_portal."""
    if not existing_row:
        return True

    old_price = existing_row.get("price")
    old_image = existing_row.get("main_image_url")
    old_updated = existing_row.get("updated_at_portal")

    new_price = to_float_safe(new_price_val)
    old_price_f = to_float_safe(old_price)

    # preço: compara float quando possível; senão compara string
    if new_price is not None or old_price_f is not None:
        if new_price is None and old_price_f is not None:
            return True
        if new_price is not None and old_price_f is None:
            return True
        if new_price is not None and old_price_f is not None and new_price != old_price_f:
            return True

    # imagem: só conta mudança se veio imagem nova (não sobrescreve por None)
    if new_image_url is not None and new_image_url != old_image:
        return True

    # updatedAt do portal
    if new_updated_at_portal is not None and new_updated_at_portal != old_updated:
        return True

    return False

# --- CONFIGURAÇÕES SUPABASE ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("❌ SUPABASE_URL e/ou SUPABASE_KEY não encontrados no .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

PORTAL = "vivareal"

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

from datetime import datetime, timezone, timedelta

def load_recent_ids(portal: str, hours: int) -> set[str]:
    """Carrega em 1 query os external_ids com published_at nas últimas N horas."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    since_iso = since.isoformat()

    try:
        res = (
            supabase.table("listings")
            .select("external_id")
            .eq("portal", portal)
            .gte("published_at", since_iso)  # <-- AGORA É PELO PUBLISHED
            .execute()
        )
        data = res.data or []
        return set(str(r.get("external_id")) for r in data if r.get("external_id") is not None)
    except Exception as e:
        print(f"⚠️ Falha ao carregar IDs recentes (published last {hours}h): {e}")
        return set()


def batch_load_existing(portal: str, ids: list[str]) -> dict[str, dict]:
    """Batch IN para buscar existentes e evitar 1 select por card."""
    if not ids:
        return {}
    try:
        res = (
            supabase.table("listings")
            .select("external_id, price, main_image_url, updated_at_portal")
            .eq("portal", portal)
            .in_("external_id", ids)
            .execute()
        )
        data = res.data or []
        return {str(r.get("external_id")): r for r in data if r.get("external_id") is not None}
    except Exception as e:
        print(f"⚠️ Falha ao batch_load_existing: {e}")
        return {}

def salvar_imovel_manual(imovel: dict, existing_row: dict | None):
    """
    Upsert otimizado:
    - INSERT se não existe (portal+external_id)
    - UPDATE completo se mudou (preço/imagem/updated_at_portal), sem alterar published_at/first_seen_at/external_id
    - Se não mudou: atualiza só last_seen_at (touch)
    """
    try:
        listing = imovel.get("listing", {}) or {}
        pricing = (listing.get("pricingInfos") or [{}])[0] or {}

        ext_id = str(listing.get("id"))
        url_card = build_card_url(imovel, ext_id)

        created_raw = listing.get("createdAt")
        updated_raw = listing.get("updatedAt")

        stamps = listing.get("stamps") or []
        price_suggestion = listing.get("priceSuggestion") if isinstance(listing.get("priceSuggestion"), dict) else {}
        below_market, below_reason = detect_below_market(listing)

        image_url = extract_main_image_url(imovel)

        now_iso = datetime.now(TZ).isoformat()

        unit_types = listing.get("unitTypes") or []
        property_type_normalized = get_normalized_type(unit_types)

        full_data = {
            "stamps": stamps,
            "priceSuggestion": price_suggestion,
            "below_market": below_market,
            "below_market_reason": below_reason,
            "unitTypes_raw": unit_types
        }

        payload = {
            "portal": PORTAL,
            "external_id": ext_id,
            "url": url_card,
            "main_image_url": image_url,
            "title": listing.get("title"),
            "property_type": property_type_normalized,
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

        # debug básico
        print(f"➡️ Processando: id={ext_id} | Type={property_type_normalized} | Price={payload['price']} | url={url_card}")

        # DECISÃO UPDATE/SKIP
        if existing_row:
            changed = should_update(existing_row, payload.get("price"), image_url, updated_raw)

            old_price_f = to_float_safe(existing_row.get("price"))
            new_price_f = to_float_safe(payload.get("price"))
            if old_price_f is not None and new_price_f is not None:
                if new_price_f < old_price_f:
                    print(f"📉 [VIVAREAL] Preço caiu id={ext_id} old={old_price_f} new={new_price_f}")
                elif new_price_f > old_price_f:
                    print(f"📈 [VIVAREAL] Preço subiu id={ext_id} old={old_price_f} new={new_price_f}")

            if changed:
                # UPDATE completo (sem imutáveis)
                update_payload = dict(payload)
                for k in ("external_id", "published_at", "first_seen_at"):
                    update_payload.pop(k, None)

                # não sobrescreve imagem com None
                if image_url is None:
                    update_payload.pop("main_image_url", None)

                if DRY_RUN:
                    print(f"🧪 DRY_RUN: 🔄 Update {ext_id} (full)")
                    return "update"

                supabase.table("listings").update(update_payload).eq("portal", PORTAL).eq("external_id", ext_id).execute()
                print(f"🔄 Atualizado (full): {ext_id}")
                return "update"
            else:
                # SKIP: só last_seen_at
                touch_payload = {"last_seen_at": now_iso}
                # se updated_at_portal veio e mudou, isso seria "changed" acima; aqui só garante touch.
                if DRY_RUN:
                    print(f"🧪 DRY_RUN: ⏭️ Sem mudança {ext_id} (touch last_seen_at)")
                    return "skip"

                supabase.table("listings").update(touch_payload).eq("portal", PORTAL).eq("external_id", ext_id).execute()
                print(f"⏭️ Sem mudança: {ext_id}")
                return "skip"

        # INSERT
        if DRY_RUN:
            print(f"🧪 DRY_RUN: ✅ Insert {ext_id}")
            return "insert"

        supabase.table("listings").insert(payload).execute()
        print(f"✅ Inserido: {ext_id}")
        return "insert"

    except Exception as e:
        print(f"❌ Erro no imóvel { (imovel.get('listing', {}) or {}).get('id') }: {e}")
        return "error"

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

    print(f"\n[{now_sp.strftime('%H:%M:%S')}] 🔎 Buscando imóveis... (SP={now_sp.strftime('%Y-%m-%d %H:%M:%S')}) | DRY_RUN={DRY_RUN} | RECENT_HOURS={RECENT_HOURS}")

    cards_collected = 0
    cards_upserted = 0
    status_code = 0
    bytes_recv = 0
    erro_msg = None

    # CONTADORES NOVOS
    count_today = 0
    count_recent = 0
    count_selected = 0
    inserts = 0
    updates = 0
    skips = 0
    errors = 0

    try:
        if PRINT_FULL_REQUEST_URL_ON_START:
            print(f"🔗 Request URL (completa): {URL}")

        print(f"🔗 Request URL (len={len(URL)}): {URL[:220]}{'...' if len(URL) > 220 else ''}")

        # 0) Pré-carrega IDs recentes (últimas 32h) em 1 query
        recent_ids_set = load_recent_ids(PORTAL, RECENT_HOURS)
        print(f"🧠 IDs recentes carregados (last {RECENT_HOURS}h): {len(recent_ids_set)}")

        response = requests.get(URL, headers=HEADERS, timeout=20)
        status_code = response.status_code
        bytes_recv = len(response.content) if response.content else 0

        print(f"🌐 HTTP {status_code} | bytes={bytes_recv}")

        if status_code == 200:
            data = response.json()
            listings = (data.get("search", {}) or {}).get("result", {}).get("listings", []) or []
            print(f"📦 Total de cards analisados (retornados pela API): {len(listings)}")

            # prints de amostra / diagnóstico
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

                u_types = listing.get("unitTypes") or []
                norm_type = get_normalized_type(u_types)

                ps = listing.get("priceSuggestion") if isinstance(listing.get("priceSuggestion"), dict) else {}
                ps_sum = summarize_price_suggestion(ps)
                bm, reason = detect_below_market(listing)

                created_dt = parse_iso(created_raw)
                created_sp_str = created_dt.astimezone(TZ).strftime("%Y-%m-%d %H:%M:%S") if created_dt else None

                print(
                    f" - id={ext_id} | Type={norm_type} | createdAt={created_raw} (SP={created_sp_str}) | "
                    f"updatedAt={updated_raw} | below_market={bm} ({reason}) | url={url_card} | ps={ps_sum}"
                )

            # 1) SELEÇÃO: createdAt==hoje OR id in recent_ids_set
            selected_items = []
            selected_ids = []

            for item in listings:
                listing = item.get("listing", {}) or {}
                ext_id = str(listing.get("id"))

                created_dt = parse_iso(listing.get("createdAt"))
                is_today = bool(created_dt and created_dt.astimezone(TZ).date() == hoje_sp)
                is_recent = ext_id in recent_ids_set

                if is_today:
                    count_today += 1
                if is_recent:
                    count_recent += 1

                if is_today or is_recent:
                    selected_items.append(item)
                    selected_ids.append(ext_id)

            count_selected = len(selected_items)

            print(f"✅ Seleção: hoje(SP)={count_today} | recentes(last {RECENT_HOURS}h)={count_recent} | selecionados={count_selected}")

            cards_collected = count_selected

            if not selected_items:
                print("Nada para processar (nem HOJE, nem IDs recentes).")
            else:
                # 2) Batch IN: carrega existentes 1 vez
                existing_by_id = batch_load_existing(PORTAL, selected_ids)
                print(f"📥 Existentes no banco (batch IN): {len(existing_by_id)} de {len(selected_ids)}")

                # 3) Upsert
                for imovel in selected_items:
                    listing = imovel.get("listing", {}) or {}
                    ext_id = str(listing.get("id"))

                    existing_row = existing_by_id.get(ext_id)
                    action = salvar_imovel_manual(imovel, existing_row)

                    if action == "insert":
                        inserts += 1
                        cards_upserted += 1
                    elif action == "update":
                        updates += 1
                        cards_upserted += 1
                    elif action == "skip":
                        skips += 1
                    else:
                        errors += 1

            # fecha run
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

        print(
            f"📊 Resumo ciclo: selecionados={count_selected} | inserts={inserts} | updates={updates} | skips={skips} | errors={errors}"
        )

        log_payload = {
            "run_id": run_id,
            "portal": PORTAL,
            "status_code": status_code,
            "duration_ms": duration,
            "bytes_received": bytes_recv,
            "cards_collected": cards_collected,   # agora é "selecionados"
            "cards_upserted": cards_upserted,     # writes (insert/update)
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
