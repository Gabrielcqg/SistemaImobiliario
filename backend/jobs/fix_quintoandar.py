import os
import time
import asyncio
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

# --- CONFIGURAÇÕES ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("❌ SUPABASE_URL e/ou SUPABASE_KEY não encontrados no .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ============================================================
# 1) LÓGICA CORRIGIDA
# ============================================================
def normalize_property_type_fixed(raw_value: str) -> str:
    if not raw_value:
        return "apartment"

    t = str(raw_value).lower().strip()

    # 1. Casas
    if any(k in t for k in ["casa", "sobrado", "house", "home"]):
        return "house"

    # 2. Apartamentos
    if any(k in t for k in ["apart", "apto", "padrao", "padrão"]):
        return "apartment"

    # 3. Lotes
    if any(k in t for k in ["lote", "terreno", "land"]):
        return "land"

    # 4. Comerciais
    if any(k in t for k in ["comercial", "loja", "sala", "office"]):
        return "commercial"
    
    # 5. Outros
    if any(k in t for k in ["studio", "kitnet", "loft", "flat"]):
        return "other"

    return "apartment"

# ============================================================
# 2) LOOP DE CORREÇÃO (AGORA VIA UPDATE INDIVIDUAL)
# ============================================================
async def fix_quintoandar():
    print("🛠️  Iniciando Correção de Tipos do QuintoAndar (Modo UPDATE Seguro)...")

    limit = 1000
    offset = 0
    total_fixed = 0
    total_processed = 0

    while True:
        print(f"\n📦 Buscando lote {offset} a {offset + limit}...")
        
        # Buscamos os dados
        response = supabase.table("listings")\
            .select("id, external_id, property_type, full_data")\
            .eq("portal", "quintoandar")\
            .range(offset, offset + limit - 1)\
            .execute()
        
        rows = response.data
        if not rows:
            print("🏁 Fim da base de dados.")
            break
        
        print(f"   Processando {len(rows)} itens...")

        for row in rows:
            total_processed += 1
            current_type = row.get("property_type")
            full_data = row.get("full_data") or {}
            
            # Tenta encontrar o tipo original
            raw_type = None
            api_source = full_data.get("api_source") or {}
            if api_source and "type" in api_source:
                raw_type = api_source.get("type")
            
            if not raw_type:
                raw_type = full_data.get("property_type_raw")
            
            if not raw_type:
                continue

            # Aplica a correção
            corrected_type = normalize_property_type_fixed(raw_type)

            # Se precisar corrigir, fazemos um UPDATE direto pelo ID
            if corrected_type != current_type:
                try:
                    # O .update() ignora colunas faltando (como url), pois só mexe no property_type
                    supabase.table("listings").update({
                        "property_type": corrected_type
                    }).eq("id", row["id"]).execute()
                    
                    total_fixed += 1
                    # print(f"✅ ID {row['external_id']} corrigido: {current_type} -> {corrected_type}")
                    
                except Exception as e:
                    print(f"❌ Falha ao atualizar ID {row['external_id']}: {e}")

        print(f"   ✅ Lote finalizado. Total acumulado corrigido: {total_fixed}")
        
        offset += limit
        time.sleep(0.5)

    print(f"\n🎉 Processo finalizado!")
    print(f"📊 Total processado: {total_processed}")
    print(f"🔧 Total corrigido: {total_fixed}")

if __name__ == "__main__":
    asyncio.run(fix_quintoandar())