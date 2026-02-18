import os
import time
import traceback
import requests
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

# ============================================================
# CONFIG / ENV
# ============================================================
TZ = ZoneInfo("America/Sao_Paulo")

DRY_RUN = str(os.getenv("DRY_RUN", "0")).lower() in ("1", "true", "yes", "y", "on")
RECENT_HOURS = int(os.getenv("RECENT_HOURS", "32"))

# HTTP resiliente
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "60"))   # read timeout
CONNECT_TIMEOUT = float(os.getenv("CONNECT_TIMEOUT", "10"))   # connect timeout
HTTP_RETRIES = int(os.getenv("HTTP_RETRIES", "3"))
HTTP_BACKOFF_BASE = float(os.getenv("HTTP_BACKOFF_BASE", "2"))  # 1,2,4...

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("❌ SUPABASE_URL e/ou SUPABASE_KEY não encontrados no .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

PORTAL = "zap"

# ============================================================
# ZAP GLUE API (HOST CORRETO)
# ============================================================
URL = "https://glue-api.zapimoveis.com.br/v4/listings?user=aeaa0c71-4ec4-4d43-a17a-84e5acac5e45&portal=ZAP&includeFields=fullUriFragments%2Cpage%2Csearch%28result%28listings%28listing%28expansionType%2CcontractType%2ClistingsCount%2CpropertyDevelopers%2CsourceId%2CdisplayAddressType%2Camenities%2CusableAreas%2CconstructionStatus%2ClistingType%2Cdescription%2Ctitle%2Cstamps%2CcreatedAt%2Cfloors%2CunitTypes%2CnonActivationReason%2CproviderId%2CpropertyType%2CunitSubTypes%2CunitsOnTheFloor%2ClegacyId%2Cid%2Cportal%2Cportals%2CunitFloor%2CparkingSpaces%2CupdatedAt%2Caddress%2Csuites%2CpublicationType%2CexternalId%2Cbathrooms%2CusageTypes%2CtotalAreas%2CadvertiserId%2CadvertiserContact%2CwhatsappNumber%2Cbedrooms%2CacceptExchange%2CpricingInfos%2CshowPrice%2Cresale%2Cbuildings%2CcapacityLimit%2Cstatus%2CpriceSuggestion%2CcondominiumName%2Cmodality%2CenhancedDevelopment%29%2Caccount%28id%2Cname%2ClogoUrl%2ClicenseNumber%2CshowAddress%2ClegacyVivarealId%2ClegacyZapId%2CcreatedDate%2Ctier%2CtrustScore%2CtotalCountByFilter%2CtotalCountByAdvertiser%29%2Cmedias%2CaccountLink%2Clink%2Cchildren%28id%2CusableAreas%2CtotalAreas%2Cbedrooms%2Cbathrooms%2CparkingSpaces%2CpricingInfos%29%29%29%2CtotalCount%29&categoryPage=RESULT&business=SALE&sort=MOST_RECENT&parentId=null&listingType=USED&__zt=mtc%3Adeduplication2023&addressCity=Campinas&addressLocationId=BR%3ESao+Paulo%3ENULL%3ECampinas&addressState=S%C3%A3o+Paulo&addressPointLat=-22.905082&addressPointLon=-47.061333&addressType=city&page=1&size=30&from=0&images=webp"

HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
    "X-DeviceId": "aeaa0c71-4ec4-4d43-a17a-84e5acac5e45",
    "x-domain": ".zapimoveis.com.br",
    "Referer": "https://www.zapimoveis.com.br/",
}

PRINT_FULL_REQUEST_URL_ON_START = True
SAMPLE_N = 10


# ============================================================
# UTILS
# ============================================================
def ts():
    return datetime.now(TZ).strftime("%H:%M:%S")


def parse_iso(dt_str: str):
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except Exception:
        return None


def to_float_safe(x):
    if x is None:
        return None
    try:
        if isinstance(x, (int, float)):
            return float(x)
        s = str(x).strip()
        if not s:
            return None
        s = s.replace("R$", "").replace(" ", "")
        if "," in s and "." in s:
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", ".")
        return float(s)
    except Exception:
        return None


def get_normalized_type(unit_types: list) -> str:
    if not unit_types or not isinstance(unit_types, list):
        return "other"
    raw = str(unit_types[0]).upper().strip()
    if raw in ("HOME", "CONDOMINIUM"):
        return "house"
    if raw == "APARTMENT":
        return "apartment"
    if "COMMERCIAL" in raw:
        return "commercial"
    return "other"


def build_card_url(item: dict, ext_id: str) -> str:
    """
    Tenta pegar URL real no JSON:
    - link.href/url/uri
    - fullUriFragments (string/list)
    - uriFragments (string/list)  [alguns payloads mudam]
    Fallback: /imovel/{id}
    """
    if not isinstance(item, dict):
        return f"https://www.zapimoveis.com.br/imovel/{ext_id}"

    listing = item.get("listing", {}) if isinstance(item.get("listing"), dict) else item

    for obj in (item.get("link"), listing.get("link")):
        if isinstance(obj, dict):
            href = obj.get("href") or obj.get("url") or obj.get("uri")
            if isinstance(href, str) and href:
                if href.startswith("/"):
                    return "https://www.zapimoveis.com.br" + href
                if href.startswith("http"):
                    return href

    for key in ("fullUriFragments", "uriFragments"):
        fuf = item.get(key) or listing.get(key)
        if isinstance(fuf, str) and fuf.strip():
            frag = fuf.strip()
            if frag.startswith("/"):
                return "https://www.zapimoveis.com.br" + frag
            if frag.startswith("http"):
                return frag
        if isinstance(fuf, list) and fuf:
            for frag in fuf:
                if isinstance(frag, str) and frag.strip():
                    frag = frag.strip()
                    if frag.startswith("/"):
                        return "https://www.zapimoveis.com.br" + frag
                    if frag.startswith("http"):
                        return frag

    return f"https://www.zapimoveis.com.br/imovel/{ext_id}"


def extract_main_image_url(item: dict) -> str | None:
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
    if not existing_row:
        return True

    old_price = existing_row.get("price")
    old_image = existing_row.get("main_image_url")
    old_updated = existing_row.get("updated_at_portal")

    new_price = to_float_safe(new_price_val)
    old_price_f = to_float_safe(old_price)

    if new_price is not None or old_price_f is not None:
        if new_price is None and old_price_f is not None:
            return True
        if new_price is not None and old_price_f is None:
            return True
        if new_price is not None and old_price_f is not None and new_price != old_price_f:
            return True

    if new_image_url is not None and new_image_url != old_image:
        return True

    if new_updated_at_portal is not None and new_updated_at_portal != old_updated:
        return True

    return False


def load_recent_ids(portal: str, hours: int) -> set[str]:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    since_iso = since.isoformat()
    try:
        res = (
            supabase.table("listings")
            .select("external_id")
            .eq("portal", portal)
            .gte("published_at", since_iso)
            .execute()
        )
        data = res.data or []
        return set(str(r.get("external_id")) for r in data if r.get("external_id") is not None)
    except Exception as e:
        print(f"[{ts()}] ⚠️ Falha ao carregar IDs recentes (published last {hours}h): {e}")
        return set()


def batch_load_existing(portal: str, ids: list[str]) -> dict[str, dict]:
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
        print(f"[{ts()}] ⚠️ Falha ao batch_load_existing: {e}")
        return {}


def http_get_with_retries(url: str, headers: dict):
    last_err = None
    for attempt in range(1, HTTP_RETRIES + 1):
        try:
            return requests.get(url, headers=headers, timeout=(CONNECT_TIMEOUT, REQUEST_TIMEOUT))
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            last_err = e
            wait = HTTP_BACKOFF_BASE ** (attempt - 1)
            print(f"[{ts()}] ⚠️ HTTP tentativa {attempt}/{HTTP_RETRIES} falhou: {type(e).__name__}: {e}")
            if attempt < HTTP_RETRIES:
                print(f"[{ts()}] ⏳ retry em {wait:.0f}s...")
                time.sleep(wait)
    raise last_err


def extract_listings(payload: dict) -> list:
    """
    O Zap pode devolver envelopes diferentes.
    Tentamos os caminhos mais comuns sem quebrar.
    """
    if not isinstance(payload, dict):
        return []

    candidates = []

    # padrão mais comum
    candidates.append((((payload.get("search") or {}).get("result") or {}).get("listings")))

    # variações
    candidates.append(((payload.get("result") or {}).get("listings")))
    candidates.append(((payload.get("search") or {}).get("listings")))
    candidates.append(payload.get("listings"))

    for c in candidates:
        if isinstance(c, list):
            return c

    return []


def sleep_com_debug(segundos=180):
    print(f"[{ts()}] ⏳ Aguardando {segundos}s para a próxima checagem...")
    checkpoint = 30
    for restante in range(segundos, 0, -1):
        if restante % checkpoint == 0 or restante <= 5:
            print(f"[{ts()}] ⏱️ {restante}s restantes...")
        time.sleep(1)
    print(f"[{ts()}] ▶️ Iniciando novo ciclo agora.")


# ============================================================
# UPSERT
# ============================================================
def salvar_imovel_zap(item: dict, existing_row: dict | None) -> str:
    """
    - INSERT se não existe (portal+external_id)
    - UPDATE completo se mudou (preço/imagem/updated_at_portal), sem alterar published_at/first_seen_at/external_id
    - Se não mudou: atualiza só last_seen_at (touch)
    """
    try:
        # alguns payloads podem vir como {"listing": {...}} ou como {...} direto
        listing = item.get("listing") if isinstance(item, dict) else None
        if not isinstance(listing, dict):
            listing = item if isinstance(item, dict) else {}

        pricing = (listing.get("pricingInfos") or [{}])[0] or {}

        ext_id = str(listing.get("id") or "").strip()
        if not ext_id:
            return "error"

        created_raw = listing.get("createdAt")
        updated_raw = listing.get("updatedAt")

        unit_types = listing.get("unitTypes") or []
        property_type_normalized = get_normalized_type(unit_types)

        image_url = extract_main_image_url(item if isinstance(item, dict) else {})
        url_card = build_card_url(item if isinstance(item, dict) else {}, ext_id)

        now_iso = datetime.now(TZ).isoformat()

        address = listing.get("address", {}) or {}
        state = (
            address.get("stateAcronym")
            or address.get("stateAC")
            or address.get("state")
            or (address.get("state", {}) or {}).get("name")  # fallback se vier objeto
        )

        usable = listing.get("usableAreas") or []
        total = listing.get("totalAreas") or []
        area_m2 = (usable[0] if isinstance(usable, list) and usable else None) or (total[0] if isinstance(total, list) and total else 0)

        payload = {
            "portal": PORTAL,
            "external_id": ext_id,
            "url": url_card,
            "main_image_url": image_url,
            "title": listing.get("title"),
            "property_type": property_type_normalized,
            "price": pricing.get("price"),
            "city": address.get("city"),
            "state": state,
            "neighborhood": address.get("neighborhood"),
            "area_m2": area_m2,
            "bedrooms": (listing.get("bedrooms") or [0])[0] if listing.get("bedrooms") else 0,
            "bathrooms": (listing.get("bathrooms") or [0])[0] if listing.get("bathrooms") else 0,
            "parking": (listing.get("parkingSpaces") or [0])[0] if listing.get("parkingSpaces") else 0,
            "condo_fee": pricing.get("monthlyCondoFee"),
            "iptu": pricing.get("yearlyIptu"),
            "last_seen_at": now_iso,
            "first_seen_at": now_iso,
            "published_at": created_raw,
            "updated_at_portal": updated_raw,
        }

        # UPDATE / SKIP
        if existing_row:
            changed = should_update(existing_row, payload.get("price"), image_url, updated_raw)

            if changed:
                update_payload = dict(payload)
                for k in ("external_id", "published_at", "first_seen_at"):
                    update_payload.pop(k, None)

                if image_url is None:
                    update_payload.pop("main_image_url", None)

                if DRY_RUN:
                    print(f"[{ts()}] 🧪 DRY_RUN: 🔄 Update {ext_id} (full)")
                    return "update"

                supabase.table("listings").update(update_payload).eq("portal", PORTAL).eq("external_id", ext_id).execute()
                return "update"

            if DRY_RUN:
                print(f"[{ts()}] 🧪 DRY_RUN: ⏭️ Skip {ext_id} (touch)")
                return "skip"

            supabase.table("listings").update({"last_seen_at": now_iso}).eq("portal", PORTAL).eq("external_id", ext_id).execute()
            return "skip"

        # INSERT
        if DRY_RUN:
            print(f"[{ts()}] 🧪 DRY_RUN: ✅ Insert {ext_id}")
            return "insert"

        supabase.table("listings").insert(payload).execute()
        return "insert"

    except Exception as e:
        print(f"[{ts()}] ❌ Erro ZAP id={(item.get('listing', {}) or {}).get('id') if isinstance(item, dict) else None}: {e}")
        traceback.print_exc()
        return "error"


# ============================================================
# CICLO
# ============================================================
def executar_ciclo_zap():
    inicio_req = time.time()

    # 1) Run
    try:
        run_res = supabase.table("scrape_runs").insert({
            "status": "running",
            "city": "Campinas",
            "state": "SP"
        }).execute()
        run_id = run_res.data[0]["id"]
    except Exception as e:
        print(f"[{ts()}] 🚨 Erro crítico ao criar Run: {e}")
        return

    now_sp = datetime.now(TZ)
    hoje_sp = now_sp.date()

    print(f"\n[{ts()}] 🔎 ZAP: ciclo | SP={now_sp.strftime('%Y-%m-%d %H:%M:%S')} | DRY_RUN={DRY_RUN} | RECENT_HOURS={RECENT_HOURS}")

    cards_collected = 0
    cards_upserted = 0
    status_code = 0
    bytes_recv = 0
    erro_msg = None

    count_today = 0
    count_recent = 0
    count_selected = 0
    inserts = 0
    updates = 0
    skips = 0
    errors = 0

    try:
        global PRINT_FULL_REQUEST_URL_ON_START
        if PRINT_FULL_REQUEST_URL_ON_START:
            print(f"[{ts()}] 🔗 Request URL (completa): {URL}")
        print(f"[{ts()}] 🔗 Request URL (len={len(URL)}): {URL[:220]}{'...' if len(URL) > 220 else ''}")

        # 0) IDs recentes (ciclo de atualização)
        recent_ids_set = load_recent_ids(PORTAL, RECENT_HOURS)
        print(f"[{ts()}] 🧠 IDs recentes carregados (last {RECENT_HOURS}h): {len(recent_ids_set)}")

        response = http_get_with_retries(URL, HEADERS)
        status_code = response.status_code
        bytes_recv = len(response.content) if response.content else 0
        print(f"[{ts()}] 🌐 HTTP {status_code} | bytes={bytes_recv}")

        if status_code != 200:
            erro_msg = f"API Error: {status_code}"
            raise Exception(erro_msg)

        data = response.json()
        listings = extract_listings(data)
        print(f"[{ts()}] 📦 Total de cards (API): {len(listings)}")

        # amostra rápida
        sample_n = min(SAMPLE_N, len(listings))
        if sample_n:
            print(f"[{ts()}] 🔎 Amostra (primeiros {sample_n}):")
            for item in listings[:sample_n]:
                listing = item.get("listing") if isinstance(item, dict) else None
                if not isinstance(listing, dict):
                    listing = item if isinstance(item, dict) else {}

                ext_id = str(listing.get("id") or "")
                created_raw = listing.get("createdAt")
                updated_raw = listing.get("updatedAt")
                created_dt = parse_iso(created_raw)
                created_sp = created_dt.astimezone(TZ).strftime("%Y-%m-%d %H:%M:%S") if created_dt else None
                norm_type = get_normalized_type(listing.get("unitTypes") or [])
                url_card = build_card_url(item if isinstance(item, dict) else {}, ext_id)

                print(f" - id={ext_id} | Type={norm_type} | createdAt={created_raw} (SP={created_sp}) | updatedAt={updated_raw} | url={url_card}")

        # 1) SELEÇÃO: HOJE(SP) OU RECENTE(last N horas)
        selected_items = []
        selected_ids = []

        for item in listings:
            listing = item.get("listing") if isinstance(item, dict) else None
            if not isinstance(listing, dict):
                listing = item if isinstance(item, dict) else {}

            ext_id = str(listing.get("id") or "").strip()
            if not ext_id:
                continue

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
        cards_collected = count_selected
        print(f"[{ts()}] ✅ Seleção: hoje(SP)={count_today} | recentes(last {RECENT_HOURS}h)={count_recent} | selecionados={count_selected}")

        if selected_items:
            existing_by_id = batch_load_existing(PORTAL, selected_ids)
            print(f"[{ts()}] 📥 Existentes (batch IN): {len(existing_by_id)} de {len(selected_ids)}")

            for item in selected_items:
                listing = item.get("listing") if isinstance(item, dict) else None
                if not isinstance(listing, dict):
                    listing = item if isinstance(item, dict) else {}

                ext_id = str(listing.get("id") or "").strip()
                existing_row = existing_by_id.get(ext_id)

                action = salvar_imovel_zap(item, existing_row)

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
        else:
            print(f"[{ts()}] 💤 Nada para processar.")

        supabase.table("scrape_runs").update({
            "status": "completed",
            "finished_at": datetime.now(TZ).isoformat()
        }).eq("id", run_id).execute()

    except Exception as e:
        erro_msg = str(e)
        print(f"[{ts()}] ❌ Falha no ciclo Zap: {e}")
        try:
            supabase.table("scrape_runs").update({"status": "failed"}).eq("id", run_id).execute()
        except Exception:
            pass

    finally:
        duration = int((time.time() - inicio_req) * 1000)
        print(f"[{ts()}] 📊 Resumo: selecionados={count_selected} | inserts={inserts} | updates={updates} | skips={skips} | errors={errors}")

        log_payload = {
            "run_id": run_id,
            "portal": PORTAL,
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
            print(f"[{ts()}] 📝 Log salvo.")
        except Exception as log_err:
            print(f"[{ts()}] ⚠️ Erro ao salvar log: {log_err}")


def sleep_com_debug(segundos=180):
    print(f"[{ts()}] ⏳ Aguardando {segundos}s para a próxima checagem...")
    checkpoint = 30
    for restante in range(segundos, 0, -1):
        if restante % checkpoint == 0 or restante <= 5:
            print(f"[{ts()}] ⏱️ {restante}s restantes...")
        time.sleep(1)
    print(f"[{ts()}] ▶️ Iniciando novo ciclo agora.")


if __name__ == "__main__":
    first = True
    while True:
        PRINT_FULL_REQUEST_URL_ON_START = first
        first = False

        executar_ciclo_zap()
        sleep_com_debug(180)
