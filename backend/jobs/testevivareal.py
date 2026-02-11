import requests
import time
from datetime import datetime

# URL COMPLETA (Copiada exatamente do seu fetch que funcionou)
URL = "https://glue-api.vivareal.com/v4/listings?user=aeaa0c71-4ec4-4d43-a17a-84e5acac5e45&portal=VIVAREAL&includeFields=fullUriFragments%2Cpage%2Csearch%28result%28listings%28listing%28expansionType%2CcontractType%2ClistingsCount%2CpropertyDevelopers%2CsourceId%2CdisplayAddressType%2Camenities%2CusableAreas%2CconstructionStatus%2ClistingType%2Cdescription%2Ctitle%2Cstamps%2CcreatedAt%2Cfloors%2CunitTypes%2CnonActivationReason%2CproviderId%2CpropertyType%2CunitSubTypes%2CunitsOnTheFloor%2ClegacyId%2Cid%2Cportal%2Cportals%2CunitFloor%2CparkingSpaces%2CupdatedAt%2Caddress%2Csuites%2CpublicationType%2CexternalId%2Cbathrooms%2CusageTypes%2CtotalAreas%2CadvertiserId%2CadvertiserContact%2CwhatsappNumber%2Cbedrooms%2CacceptExchange%2CpricingInfos%2CshowPrice%2Cresale%2Cbuildings%2CcapacityLimit%2Cstatus%2CpriceSuggestion%2CcondominiumName%2Cmodality%2CenhancedDevelopment%29%2Caccount%28id%2Cname%2ClogoUrl%2ClicenseNumber%2CshowAddress%2ClegacyVivarealId%2ClegacyZapId%2CcreatedDate%2Ctier%2CtrustScore%2CtotalCountByFilter%2CtotalCountByAdvertiser%29%2Cmedias%2CaccountLink%2Clink%2Cchildren%28id%2CusableAreas%2CtotalAreas%2Cbedrooms%2Cbathrooms%2CparkingSpaces%2CpricingInfos%29%29%29%2CtotalCount%29&categoryPage=RESULT&business=SALE&sort=MOST_RECENT&parentId=null&listingType=USED&__zt=mtc%3Adeduplication2023&addressCity=Campinas&addressLocationId=BR%3ESao+Paulo%3ENULL%3ECampinas&addressState=S%C3%A3o+Paulo&addressPointLat=-22.905082&addressPointLon=-47.061333&addressType=city&page=1&size=50&from=0&images=webp"

# HEADERS IDENTICOS AO SAFARI
HEADERS = {
    "Accept": "*/*",
    "Accept-Language": "pt-BR,pt;q=0.9",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
    "X-DeviceId": "aeaa0c71-4ec4-4d43-a17a-84e5acac5e45",
    "x-domain": ".vivareal.com.br",
    "Referer": "https://www.vivareal.com.br/",
}

def monitorar():
    # Data de hoje para o filtro de "pente fino"
    hoje = datetime.now().strftime("%Y-%m-%d")
    
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 🔎 VIGILANTE ATIVADO")
    print(f"[*] Buscando imóveis criados em: {hoje}")
    print("-" * 60)

    while True:
        try:
            agora = datetime.now().strftime('%H:%M:%S')
            response = requests.get(URL, headers=HEADERS, timeout=20)

            if response.status_code == 200:
                data = response.json()
                listings = data.get('search', {}).get('result', {}).get('listings', [])
                
                # Pente fino nos 50 resultados da página
                encontrados_hoje = []
                for item in listings:
                    criado_em = item['listing'].get('createdAt', '')
                    if criado_em.startswith(hoje):
                        encontrados_hoje.append(item['listing'])

                if encontrados_hoje:
                    print(f"\n🚨 {len(encontrados_hoje)} IMÓVEIS NOVOS DETECTADOS!")
                    for imovel in encontrados_hoje:
                        preco = imovel['pricingInfos'][0].get('price', 'N/A')
                        bairro = imovel['address'].get('neighborhood', 'N/A')
                        print(f"📍 {bairro} | 💰 R$ {preco}")
                        print(f"🔗 https://www.vivareal.com.br/imovel/{imovel['id']}")
                        print("-" * 30)
                else:
                    # Log de status para saber que está funcionando
                    topo_criado = listings[0]['listing']['createdAt'][:10] if listings else "N/A"
                    print(f"[{agora}] API OK ✅ | Analisados: {len(listings)} | Topo da lista: {topo_criado} | Nada de hoje.")

            else:
                print(f"[{agora}] ⚠️ Erro {response.status_code} na API.")
            
            # Espera 3 minutos para a próxima checada
            time.sleep(180)

        except Exception as e:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] ❌ Erro: {e}")
            time.sleep(60)

if __name__ == "__main__":
    monitorar()