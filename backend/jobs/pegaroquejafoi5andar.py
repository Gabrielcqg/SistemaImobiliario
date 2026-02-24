import json
import time
from bs4 import BeautifulSoup
from curl_cffi import requests

def find_date_in_json(obj, target_keys):
    """
    Varre um objeto JSON recursivamente procurando por chaves de data.
    """
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in target_keys and value is not None:
                return value
            result = find_date_in_json(value, target_keys)
            if result:
                return result
    elif isinstance(obj, list):
        for item in obj:
            result = find_date_in_json(item, target_keys)
            if result:
                return result
    return None

def get_quintoandar_date(url):
    """
    Acessa a página do imóvel burlando o WAF e extrai a data de publicação.
    """
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    }
    
    try:
        # Usando curl_cffi para simular um navegador real (impersonate) e passar pelo Cloudflare
        response = requests.get(url, headers=headers, impersonate="chrome110", timeout=15)
        
        if response.status_code != 200:
            return None
            
        soup = BeautifulSoup(response.text, 'html.parser')
        next_data_script = soup.find('script', id='__NEXT_DATA__')
        
        if next_data_script:
            json_data = json.loads(next_data_script.string)
            
            # Chaves que o QuintoAndar costuma usar para datas
            keys_to_look_for = ['createdAt', 'publishedAt', 'publicationDate', 'insertDate', 'availableFrom']
            
            published_date = find_date_in_json(json_data, keys_to_look_for)
            return published_date
            
    except Exception as e:
        print(f"Erro ao processar {url}: {e}")
        
    return None

# Lista de URLs baseada na sua tabela
urls = [
    "https://www.quintoandar.com.br/imovel/895298783/comprar/apartamento-2-quartos-jardim-brasil-campinas",
    "https://www.quintoandar.com.br/imovel/892942064/comprar/apartamento-3-quartos-jardim-primavera-campinas",
    "https://www.quintoandar.com.br/imovel/893674913/comprar/apartamento-2-quartos-cidade-satelite-iris-campinas",
    "https://www.quintoandar.com.br/imovel/895291978/comprar/casa-3-quartos-jardim-nova-europa-campinas",
    "https://www.quintoandar.com.br/imovel/895289911/comprar/apartamento-3-quartos-centro-campinas",
    "https://www.quintoandar.com.br/imovel/895296755/comprar/apartamento-2-quartos-fundacao-da-casa-popular-campinas",
    "https://www.quintoandar.com.br/imovel/895299682/comprar/apartamento-3-quartos-jardim-nova-europa-campinas",
    "https://www.quintoandar.com.br/imovel/892845925/comprar/apartamento-1-quarto-cambui-campinas",
    "https://www.quintoandar.com.br/imovel/893044126/comprar/apartamento-2-quartos-centro-campinas",
    "https://www.quintoandar.com.br/imovel/895291856/comprar/apartamento-2-quartos-taquaral-campinas",
    "https://www.quintoandar.com.br/imovel/894544128/comprar/apartamento-2-quartos-centro-campinas",
    "https://www.quintoandar.com.br/imovel/895300081/comprar/apartamento-2-quartos-jardim-nova-europa-campinas",
    "https://www.quintoandar.com.br/imovel/895084673/comprar/apartamento-3-quartos-conjunto-residencial-souza-queiroz-campinas",
    "https://www.quintoandar.com.br/imovel/894096158/comprar/apartamento-3-quartos-jardim-primavera-campinas",
    "https://www.quintoandar.com.br/imovel/894156478/comprar/casa-4-quartos-residencial-barao-do-cafe-campinas"
]

def main():
    resultados = []
    
    for full_url in urls:
        # Limpa os parâmetros da URL para evitar problemas de roteamento ou tracking
        clean_url = full_url.split('?')[0] 
        print(f"Buscando data para: {clean_url}")
        
        data_publicacao = get_quintoandar_date(clean_url)
        
        resultados.append({
            "url": clean_url,
            "published_at": data_publicacao
        })
        
        if data_publicacao:
            print(f"-> Encontrado: {data_publicacao}")
        else:
            print("-> Data não localizada.")
            
        # Pausa aleatória entre 2 e 4 segundos para evitar rate limit
        time.sleep(2)

    print("\n--- Resumo Final ---")
    for item in resultados:
        print(f"URL: {item['url']} | Publicado em: {item['published_at']}")

if __name__ == "__main__":
    main()