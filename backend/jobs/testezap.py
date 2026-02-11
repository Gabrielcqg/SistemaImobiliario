import os
import requests
import time
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

# --- CONFIGURAÇÕES SUPABASE ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- CONFIGURAÇÕES ZAP IMÓVEIS ---
# URL com portal=ZAP
URL = "https://glue-api.vivareal.com/v4/listings?user=aeaa0c71-4ec4-4d43-a17a-84e5acac5e45&portal=ZAP&includeFields=fullUriFragments%2Cpage%2Csearch%28result%28listings%28listing%28expansionType%2CcontractType%2ClistingsCount%2CpropertyDevelopers%2CsourceId%2CdisplayAddressType%2Camenities%2CusableAreas%2CconstructionStatus%2ClistingType%2Cdescription%2Ctitle%2Cstamps%2CcreatedAt%2Cfloors%2CunitTypes%2CnonActivationReason%2CproviderId%2CpropertyType%2CunitSubTypes%2CunitsOnTheFloor%2ClegacyId%2Cid%2Cportal%2Cportals%2CunitFloor%2CparkingSpaces%2CupdatedAt%2Caddress%2Csuites%2CpublicationType%2CexternalId%2Cbathrooms%2CusageTypes%2CtotalAreas%2CadvertiserId%2CadvertiserContact%2CwhatsappNumber%2Cbedrooms%2CacceptExchange%2CpricingInfos%2CshowPrice%2Cresale%2Cbuildings%2CcapacityLimit%2Cstatus%2CpriceSuggestion%2CcondominiumName%2Cmodality%2CenhancedDevelopment%29%2Caccount%28id%2Cname%2ClogoUrl%2ClicenseNumber%2CshowAddress%2ClegacyVivarealId%2ClegacyZapId%2CcreatedDate%2Ctier%2CtrustScore%2CtotalCountByFilter%2CtotalCountByAdvertiser%29%2Cmedias%2CaccountLink%2Clink%2Cchildren%28id%2CusableAreas%2CtotalAreas%2Cbedrooms%2Cbathrooms%2CparkingSpaces%2CpricingInfos%29%29%29%2CtotalCount%29&categoryPage=RESULT&business=SALE&sort=MOST_RECENT&parentId=null&listingType=USED&__zt=mtc%3Adeduplication2023&addressCity=Campinas&addressLocationId=BR%3ESao+Paulo%3ENULL%3ECampinas&addressState=S%C3%A3o+Paulo&addressPointLat=-22.905082&addressPointLon=-47.061333&addressType=city&page=1&size=50&from=0&images=webp"

HEADERS = { 
    "Accept": "*/*", 
    "Accept-Language": "pt-BR,pt;q=0.9", 
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15", 
    "X-DeviceId": "aeaa0c71-4ec4-4d43-a17a-84e5acac5e45", 
    "x-domain": ".zapimoveis.com.br", 
    "Referer": "https://www.zapimoveis.com.br/", 
} 

def salvar_imovel_zap(imovel_data):
    try:
        listing = imovel_data['listing']
        pricing = listing.get('pricingInfos', [{}])[0]
        ext_id = str(listing.get('id'))
        
        # Payload com a mesma estrutura do VivaReal, mas portal 'zap'
        payload = {
            "portal": "zap", 
            "external_id": ext_id,
            "url": f"https://www.zapimoveis.com.br/imovel/{ext_id}",
            "title": listing.get('title'),
            "price": pricing.get('price'),
            "city": listing.get('address', {}).get('city'),
            "state": listing.get('address', {}).get('stateAC'),
            "neighborhood": listing.get('address', {}).get('neighborhood'),
            "area_m2": listing.get('usableAreas', [0])[0] if listing.get('usableAreas') else 0,
            "bedrooms": listing.get('bedrooms', [0])[0] if listing.get('bedrooms') else 0,
            "bathrooms": listing.get('bathrooms', [0])[0] if listing.get('bathrooms') else 0,
            "parking": listing.get('parkingSpaces', [0])[0] if listing.get('parkingSpaces') else 0,
            "condo_fee": pricing.get('monthlyCondoFee'),
            "iptu": pricing.get('yearlyIptu'),
            "last_seen_at": datetime.now().isoformat(),
            "first_seen_at": datetime.now().isoformat(),
            "published_at": listing.get('createdAt'),
            "updated_at_portal": listing.get('updatedAt')
        }

        # Verifica duplicidade
        existe = supabase.table("listings").select("id").eq("external_id", ext_id).execute()
        
        if existe.data and len(existe.data) > 0:
            # Lógica de Update: Removemos o que não deve ser sobrescrito
            del payload["external_id"] 
            del payload["published_at"]   
            del payload["first_seen_at"]  
            
            supabase.table("listings").update(payload).eq("external_id", ext_id).execute()
            print(f"🔄 [ZAP] Atualizado: {ext_id}")
        else:
            # Lógica de Insert
            supabase.table("listings").insert(payload).execute()
            print(f"✅ [ZAP] Novo Imóvel: {ext_id}")
            
        return True
    except Exception as e:
        print(f"❌ Erro ao processar imóvel ZAP {imovel_data.get('listing',{}).get('id')}: {e}")
        return False

def executar_ciclo_zap():
    hoje = datetime.now().strftime("%Y-%m-%d")
    inicio_req = time.time()
    
    # Criar registro de Run
    try:
        run_res = supabase.table("scrape_runs").insert({
            "status": "running",
            "city": "Campinas",
            "state": "SP"
        }).execute()
        run_id = run_res.data[0]['id']
    except Exception as e:
        print(f"🚨 Erro crítico ao criar Run: {e}")
        return

    print(f"[{datetime.now().strftime('%H:%M:%S')}] 🔎 ZAP VIGILANTE: Buscando hoje ({hoje})...")

    cards_collected = 0
    cards_upserted = 0
    status_code = 0
    bytes_recv = 0
    erro_msg = None

    try:
        response = requests.get(URL, headers=HEADERS, timeout=20)
        status_code = response.status_code
        bytes_recv = len(response.content) if response.content else 0
        
        if response.status_code == 200:
            data = response.json()
            listings = data.get('search', {}).get('result', {}).get('listings', [])
            
            # Filtra apenas os criados hoje
            encontrados_hoje = [item for item in listings if item['listing'].get('createdAt', '').startswith(hoje)]
            cards_collected = len(encontrados_hoje)

            if encontrados_hoje:
                print(f"🔥 Encontrados {cards_collected} novos imóveis no Zap!")
                for imovel in encontrados_hoje:
                    if salvar_imovel_zap(imovel):
                        cards_upserted += 1
            else:
                print("💤 Nada novo no Zap por enquanto.")

            # Finaliza Run com Sucesso
            supabase.table("scrape_runs").update({
                "status": "completed",
                "finished_at": datetime.now().isoformat()
            }).eq("id", run_id).execute()

        else:
            erro_msg = f"Erro API Zap: {response.status_code}"
            raise Exception(erro_msg)

    except Exception as e:
        erro_msg = str(e)
        print(f"❌ Falha no ciclo Zap: {e}")
        try:
            supabase.table("scrape_runs").update({"status": "failed"}).eq("id", run_id).execute()
        except:
            pass

    finally:
        # Registrar Log
        duration = int((time.time() - inicio_req) * 1000)
        log_payload = {
            "run_id": run_id,
            "portal": "zap", 
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
        except Exception as log_err:
            print(f"⚠️ Erro ao salvar log: {log_err}")

if __name__ == "__main__":
    while True:
        executar_ciclo_zap()
        time.sleep(180) # Espera 3 minutos para a próxima checagem