import requests
import json

def testar_api():
    # A URL exata que você está tentando acessar
    url = "https://glue-api.vivareal.com/v4/listings?user=aeaa0c71-4ec4-4d43-a17a-84e5acac5e45&portal=VIVAREAL&includeFields=fullUriFragments%2Cpage%2Csearch%28result%28listings%28listing%28expansionType%2CcontractType%2ClistingsCount%2CpropertyDevelopers%2CsourceId%2CdisplayAddressType%2Camenities%2CusableAreas%2CconstructionStatus%2ClistingType%2Cdescription%2Ctitle%2Cstamps%2CcreatedAt%2Cfloors%2CunitTypes%2CnonActivationReason%2CproviderId%2CpropertyType%2CunitSubTypes%2CunitsOnTheFloor%2ClegacyId%2Cid%2Cportal%2Cportals%2CunitFloor%2CparkingSpaces%2CupdatedAt%2Caddress%2Csuites%2CpublicationType%2CexternalId%2Cbathrooms%2CusageTypes%2CtotalAreas%2CadvertiserId%2CadvertiserContact%2CwhatsappNumber%2Cbedrooms%2CacceptExchange%2CpricingInfos%2CshowPrice%2Cresale%2Cbuildings%2CcapacityLimit%2Cstatus%2CpriceSuggestion%2CcondominiumName%2Cmodality%2CenhancedDevelopment%29%2Caccount%28id%2Cname%2ClogoUrl%2ClicenseNumber%2CshowAddress%2ClegacyVivarealId%2ClegacyZapId%2CcreatedDate%2Ctier%2CtrustScore%2CtotalCountByFilter%2CtotalCountByAdvertiser%29%2Cmedias%2CaccountLink%2Clink%2Cchildren%28id%2CusableAreas%2CtotalAreas%2Cbedrooms%2Cbathrooms%2CparkingSpaces%2CpricingInfos%29%29%29%2CtotalCount%29&categoryPage=RESULT&business=SALE&sort=MOST_RECENT&parentId=null&listingType=USED&__zt=mtc%3Adeduplication2023&addressCity=Campinas&addressLocationId=BR%3ESao+Paulo%3ENULL%3ECampinas&addressState=S%C3%A3o+Paulo&addressPointLat=-22.905082&addressPointLon=-47.061333&addressType=city&page=1&size=50&from=0&images=webp"

    # Headers simulando um navegador Google Chrome no Windows
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Origin": "https://www.vivareal.com.br",
        "Referer": "https://www.vivareal.com.br/",
        "x-domain": "www.vivareal.com.br" # Algumas APIs deles exigem isso
    }

    try:
        print("Enviando requisição para a API...")
        response = requests.get(url, headers=headers, timeout=15)

        print(f"\n--- Resultado ---")
        print(f"Status Code: {response.status_code}")

        if response.status_code == 200:
            print("Sucesso! A API autorizou a requisição e retornou os dados.")
            dados = response.json()
            # Tenta pegar a quantidade de imóveis retornados para confirmar que veio certo
            if 'search' in dados and 'totalCount' in dados['search']:
                print(f"Total de imóveis encontrados: {dados['search']['totalCount']}")
            else:
                print("A API retornou 200, mas a estrutura do JSON parece diferente do esperado.")
        
        elif response.status_code == 403:
            print("Falha! Bloqueio 403 Forbidden. O anti-bot barrou a requisição.")
            print("Conteúdo da resposta (pode indicar o tipo de bloqueio, ex: Cloudflare):")
            print(response.text[:500]) # Mostra apenas o começo para não poluir o terminal
        
        else:
            print(f"Erro diferente: {response.status_code}")
            print(response.text[:500])

    except Exception as e:
        print(f"Erro ao tentar executar o request: {e}")

if __name__ == "__main__":
    testar_api()