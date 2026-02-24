import os
import json
import re
import time
from pathlib import Path
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import requests
from supabase import create_client, Client

TZ_SP = ZoneInfo("America/Sao_Paulo")
PORTAL = "quintoandar"

# =========================================================
# 1. COLE SUA URL E HEADERS AQUI (Adeus .env)
# =========================================================
QA_SEARCH_URL = "COLE_AQUI_A_URL_DO_NETWORK" 
QA_METHOD = "POST"

QA_HEADERS = {
    # Cole os headers aqui se a API bloquear sem eles. Exemplo:
    # "User-Agent": "Mozilla/5.0...",
    # "Content-Type": "application/json"
}

# =========================================================
# 2. CHAVES DO SUPABASE (Opcional para esse teste)
# =========================================================
SUPABASE_URL = os.getenv("SUPABASE_URL", "") 
SUPABASE_WRITE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# ---------------- Configurações do Teste ----------------
PAGE_SIZE = 50
PAGES = 1 # Reduzi para 1 só para teste rápido
FORCE_LOCAL_SORT = True
DRY_RUN = True # Mantive True para ele só printar e não tentar gravar no banco
DEAL_TYPE = "venda"

supabase_write: Client | None = None
if SUPABASE_URL and SUPABASE_WRITE_KEY:
    try:
        supabase_write = create_client(SUPABASE_URL, SUPABASE_WRITE_KEY)
    except Exception:
        pass

# ---------------- Utils ----------------
def now_sp() -> datetime:
    return datetime.now(TZ_SP)

def now_iso_sp() -> str:
    return now_sp().isoformat()

def ts() -> str:
    return now_sp().strftime("%H:%M:%S")

def extract_ts14_from_text(s: str) -> str | None:
    if not s:
        return None
    m = re.search(r"(20\d{12})", str(s))
    return m.group(1) if m else None

def published_at_from_images(src: dict) -> str | None:
    ts14 = extract_ts14_from_text(str(src.get("coverImage") or ""))
    if not ts14:
        img_list = src.get("imageList") or []
        if isinstance(img_list, list):
            for it in img_list[:10]:
                ts14 = extract_ts14_from_text(str(it))
                if ts14:
                    break
    if not ts14:
        return None
    try:
        dt = datetime.strptime(ts14, "%Y%m%d%H%M%S").replace(tzinfo=TZ_SP)
        return dt.isoformat()
    except Exception:
        return None

def build_url_from_id(listing_id: str) -> str:
    return f"https://www.quintoandar.com.br/imovel/{listing_id}"

# ---------------- API fetch ----------------
def build_payload(page_index: int) -> tuple[dict, dict]:
    offset = page_index * PAGE_SIZE
    params = {}
    payload = {
        "page": page_index + 1,
        "size": PAGE_SIZE
    }

    # =========================================================
    # ÁREA DE TENTATIVAS DE ORDENAÇÃO (Altere aqui para testar)
    # =========================================================
    
    # Tentativa 1: Padrão ElasticSearch direto
    payload["sort"] = [{"createdAt": "desc"}]
    
    # Se a Tentativa 1 falhar, comente a linha acima e tente a 2:
    # payload["sorting"] = "PUBLISH_DATE_DESC"
    
    # Se a 2 falhar, tente a 3:
    # payload["orderBy"] = "DATE"
    # payload["order"] = "DESC"

    return params, payload

def fetch_listings() -> list[dict]:
    all_hits: list[dict] = []

    if QA_SEARCH_URL == "COLE_AQUI_A_URL_DO_NETWORK":
        print(f"[{ts()}] ❌ AVISO: Você esqueceu de colocar a URL na variável QA_SEARCH_URL lá no topo!")
        return []

    for p in range(PAGES):
        params, payload = build_payload(p)

        if QA_METHOD == "GET":
            r = requests.get(QA_SEARCH_URL, headers=QA_HEADERS, params=params, timeout=25)
        else:
            r = requests.post(QA_SEARCH_URL, headers=QA_HEADERS, params=params, json=payload, timeout=25)

        if r.status_code != 200:
            print(f"[{ts()}] ❌ Erro da API: status={r.status_code} body={r.text[:200]}")
            return []

        data = r.json()
        hits = (data.get("hits") or {}).get("hits") or []
        if not isinstance(hits, list):
            hits = []

        print(f"[{ts()}] [QA] page={p+1} hits={len(hits)}", flush=True)
        all_hits.extend(hits)

    return all_hits

# ---------------- Mapping ----------------
def hit_to_row(hit: dict) -> dict | None:
    src = (hit or {}).get("_source") or {}
    if not isinstance(src, dict) or not src:
        return None

    listing_id = str(src.get("id") or hit.get("_id") or "").strip()
    if not listing_id:
        return None

    published_at = published_at_from_images(src) 
    now_iso = now_iso_sp()

    row = {
        "external_id": listing_id,
        "published_at": published_at or now_iso, 
    }
    return row

def sort_rows_local(rows: list[dict]) -> list[dict]:
    def keyfn(r: dict):
        s = r.get("published_at") or ""
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return datetime(1970,1,1,tzinfo=timezone.utc)
    return sorted(rows, key=keyfn, reverse=True)

# ---------------- Main cycle ----------------
def executar_ciclo_quintoandar():
    print(f"[{ts()}] [QA] Teste iniciado...", flush=True)

    hits = fetch_listings()
    if not hits:
        return

    rows = []
    for h in hits:
        row = hit_to_row(h)
        if row:
            rows.append(row)

    # =========================================================
    # PROVA DOS 9: DEBUG PARA VER SE A API RESPEITOU A ORDEM
    # =========================================================
    if rows:
        print(f"\n[{ts()}] 🔎 [RESULTADO DA API] Primeiros 5 imóveis retornados (ANTES da ordenação local):")
        for i, r in enumerate(rows[:5]):
            print(f"  {i+1}: ID {r.get('external_id')} -> Data: {r.get('published_at')}")
            
    print("\n---------------------------------------------------")
    print("Se as datas acima estiverem embaralhadas, a API ignorou o payload de ordenação.")
    print("Mude o payload na função `build_payload` e rode de novo.")
    print("---------------------------------------------------\n")

if __name__ == "__main__":
    executar_ciclo_quintoandar()