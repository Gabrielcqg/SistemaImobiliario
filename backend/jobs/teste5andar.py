import cloudscraper
import time
from datetime import datetime

# URL ATUALIZADA (Conforme sua imagem do Network)
# Mude SÓ essa linha no seu código:
URL_API = "https://apigw.prod.quintoandar.com.br/graphql"

HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-QuintoAndar-Product": "marketplace",
    "Origin": "https://www.quintoandar.com.br",
    "Referer": "https://www.quintoandar.com.br/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# Payload ajustado para o formato que esse gateway costuma receber
PAYLOAD = {
    "filters": {
        "city": "Campinas",
        "businessContext": "SALE", # Ou RENTAL para aluguel
    },
    "sorting": {
        "field": "RECENCY",
        "order": "DESC"
    },
    "resultsPerPage": 20,
    "offset": 0
}

def monitorar():
    scraper = cloudscraper.create_scraper()
    ids_vistos = set()
    primeira_rodada = True
    
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 🦊 VIGILANTE CONECTADO AO GATEWAY PROD")
    print("-" * 60)

    while True:
        try:
            # Note que agora é um POST direto para o endpoint de search
            response = scraper.post(URL_API, json=PAYLOAD, headers=HEADERS, timeout=30)
            
            if response.status_code == 200:
                data = response.json()
                # A estrutura do QuintoAndar via Gateway costuma ser: hits -> hits
                listings = data.get('hits', {}).get('hits', [])
                
                novos_count = 0
                for item in listings:
                    source = item.get('_source', {})
                    imovel_id = str(source.get('id'))
                    
                    if imovel_id not in ids_vistos:
                        if not primeira_rodada:
                            # Verifica a tag de novo no campo fields
                            tags = item.get('fields', {}).get('listingTags', [])
                            novo_status = " [NOVO!] " if "NEW_AD" in tags else ""
                            
                            bairro = source.get('neighbourhood', 'N/A')
                            preco = source.get('salePrice', 'N/A')
                            
                            print(f"🚨{novo_status}ENCONTRADO: {bairro} | R$ {preco}")
                            print(f"🔗 https://www.quintoandar.com.br/imovel/{imovel_id}")
                            print("-" * 30)
                            novos_count += 1
                        
                        ids_vistos.add(imovel_id)
                
                if primeira_rodada:
                    print(f"[*] Monitoramento ativo. {len(ids_vistos)} imóveis na base inicial.")
                    primeira_rodada = False
                elif novos_count == 0:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] API OK ✅ | Sem novos anúncios no topo.")

            else:
                print(f"⚠️ Erro {response.status_code}: {response.text[:100]}")

            # Intervalo de 5 minutos para evitar banimento por IP
            time.sleep(300)

        except Exception as e:
            print(f"❌ Falha: {e}")
            time.sleep(60)

if __name__ == "__main__":
    monitorar()