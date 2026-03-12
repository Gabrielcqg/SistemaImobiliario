import os
import re
import time
import random
from datetime import datetime
from zoneinfo import ZoneInfo
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client, Client

# 🛑 IMPORTAÇÃO NINJA: Substitui o requests padrão pelo curl_cffi
from curl_cffi import requests

# --- CONFIGURAÇÕES ---
load_dotenv()
TZ = ZoneInfo("America/Sao_Paulo")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("❌ Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no arquivo .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
TABLE_NAME = "listings"

# --- LISTA DE LINKS ---
links_to_scrape = [
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-loteamento-parque-sao-martinho-campinas-com-garagem-66m2-venda-RS600000-id-2874583510/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-parque-das-universidades-campinas-com-garagem-239m2-venda-RS1500000-id-2874583482/",
    "https://www.vivareal.com.br/imovel/casa-4-quartos-vila-nogueira-campinas-com-garagem-260m2-venda-RS800000-id-2874583674/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-alphaville-dom-pedro-campinas-com-garagem-380m2-venda-RS6500000-id-2874580849/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-jardim-belo-horizonte-campinas-com-garagem-185m2-venda-RS1590000-id-2874580848/",
    "https://www.vivareal.com.br/imovel/fazenda---sitio-fazenda-tamburi-campinas-199873m2-venda-RS14702000-id-2874582086/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-primavera-campinas-com-garagem-60m2-venda-RS449420-id-2874577015/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-parque-rural-fazenda-santa-candida-campinas-com-garagem-97m2-venda-RS849600-id-2874577139/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-nova-europa-campinas-com-garagem-52m2-venda-RS445870-id-2874580491/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-taquaral-campinas-com-garagem-68m2-venda-RS669510-id-2874577263/",
    "https://www.vivareal.com.br/imovel/casa-4-quartos-jardim-miranda-campinas-com-garagem-146m2-venda-RS399220-id-2874579653/",
    "https://www.vivareal.com.br/imovel/sala-comercial-cambui-campinas-com-garagem-136m2-venda-RS1199320-id-2874580711/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-cambui-campinas-com-garagem-105m2-venda-RS1349130-id-2874580821/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-bosque-campinas-com-garagem-86m2-venda-RS690790-id-2874581674/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-nova-europa-campinas-com-garagem-54m2-venda-RS317830-id-2874578448/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-cambui-campinas-com-garagem-92m2-venda-RS829800-id-2874580421/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-4-quartos-caminhos-de-san-conrado-sousas-campinas-com-garagem-253m2-venda-RS1748260-id-2874578985/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-loteamento-santa-ana-do-atibaia-sousas-campinas-com-garagem-155m2-venda-RS1798881-id-2874580361/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-vila-industrial-campinas-com-garagem-117m2-venda-RS462839-id-2874580351/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-vila-industrial-campinas-com-garagem-72m2-venda-RS339400-id-2874577122/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-jardim-conceicao-campinas-com-garagem-113m2-venda-RS579800-id-2874578594/",
    "https://www.vivareal.com.br/imovel/casa-4-quartos-jardim-chapadao-campinas-com-garagem-293m2-venda-RS819620-id-2874577493/",
    "https://www.vivareal.com.br/imovel/cobertura-5-quartos-cambui-campinas-com-garagem-900m2-venda-RS3499590-id-2874575255/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-centro-campinas-113m2-venda-RS439070-id-2874575735/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-jardim-ipiranga-campinas-com-garagem-143m2-venda-RS619799-id-2874576092/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-parque-prado-campinas-com-garagem-128m2-venda-RS499999430-id-2874572649/",
    "https://www.vivareal.com.br/imovel/galpao-deposito-armazem-1-quartos-chacara-tres-marias-campinas-com-garagem-594m2-venda-RS1099430-id-2874573918/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-4-quartos-swiss-park-campinas-com-garagem-255m2-venda-RS2648160-id-2874571361/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-cambui-campinas-com-garagem-40m2-venda-RS649570-id-2874572125/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-nova-europa-campinas-com-garagem-51m2-venda-RS275000-id-2874563118/",
    "https://www.vivareal.com.br/imovel/sala-comercial-3-quartos-jardim-nova-europa-campinas-com-garagem-65m2-aluguel-RS3500-id-2874560591/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-dos-oliveiras-campinas-com-garagem-64m2-aluguel-RS1200-id-2874524036/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-vila-miguel-vicente-cury-campinas-com-garagem-121m2-venda-RS430000-id-2874511309/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-das-bandeiras-campinas-com-garagem-48m2-venda-RS200000-id-2874505452/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-loteamento-parque-sao-martinho-campinas-com-garagem-47m2-venda-RS270000-id-2874514589/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-san-diego-campinas-com-garagem-53m2-venda-RS199000-id-2874505445/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-parque-camelias-campinas-com-garagem-57m2-venda-RS240000-id-2874511303/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-conjunto-habitacional-parque-itajai-campinas-com-garagem-52m2-venda-RS170000-id-2874511301/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-garcia-campinas-com-garagem-41m2-venda-RS298000-id-2874514682/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-conjunto-residencial-souza-queiroz-campinas-com-garagem-70m2-venda-RS220000-id-2874513430/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-vila-joao-jorge-campinas-com-garagem-80m2-venda-RS280000-id-2874513426/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-vila-industrial-campinas-com-garagem-60m2-venda-RS235000-id-2874509419/",
    "https://www.vivareal.com.br/imovel/lote-terreno-jardim-liliza-campinas-250m2-venda-RS150000-id-2874514678/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-vila-saturnia-campinas-com-garagem-57m2-venda-RS295000-id-2874513302/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-ponte-preta-campinas-com-garagem-75m2-venda-RS280000-id-2874511948/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-centro-campinas-48m2-venda-RS250000-id-2874514002/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-aurelia-campinas-50m2-venda-RS220000-id-2874513099/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-4-quartos-caminhos-de-san-conrado-sousas-campinas-com-garagem-371m2-venda-RS1650000-id-2874507369/",
    "https://www.vivareal.com.br/imovel/ponto-comercial-centro-campinas-50m2-aluguel-RS2500-id-2874469674/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-jardim-rossin-campinas-39m2-venda-RS120882-id-2874445776/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-jardim-rossin-campinas-39m2-venda-RS126926-id-2874445680/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-parque-rural-fazenda-santa-candida-campinas-com-garagem-47m2-venda-RS390000-id-2874434391/",
    "https://www.vivareal.com.br/imovel/casa-2-quartos-parque-rural-fazenda-santa-candida-campinas-com-garagem-80m2-venda-RS620000-id-2874435382/",
    "https://www.vivareal.com.br/imovel/sobrado-3-quartos-swiss-park-campinas-com-garagem-249m2-venda-RS2790000-id-2874431018/",
    "https://www.vivareal.com.br/imovel/sobrado-4-quartos-swiss-park-campinas-com-garagem-310m2-venda-RS4000000-id-2874434690/",
    "https://www.vivareal.com.br/imovel/sobrado-4-quartos-loteamento-alphaville-campinas-campinas-com-garagem-531m2-venda-RS8990000-id-2874431017/",
    "https://www.vivareal.com.br/imovel/sobrado-3-quartos-swiss-park-campinas-com-garagem-318m2-venda-RS1890000-id-2874431238/",
    "https://www.vivareal.com.br/imovel/sobrado-4-quartos-swiss-park-campinas-com-garagem-340m2-venda-RS4600000-id-2874431239/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-cambui-campinas-com-garagem-194m2-venda-RS3580000-id-2874359618/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-centro-campinas-com-garagem-67m2-venda-RS449000-id-2874359617/",
    "https://www.vivareal.com.br/imovel/sobrado-4-quartos-parque-nova-campinas-campinas-com-garagem-370m2-venda-RS1465000-id-2874359616/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-cambui-campinas-com-garagem-104m2-venda-RS1340000-id-2874359221/",
    "https://www.vivareal.com.br/imovel/apartamento-4-quartos-cambui-campinas-com-garagem-568m2-venda-RS3980000-id-2874360188/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-centro-campinas-com-garagem-54m2-venda-RS670000-id-2874359010/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-centro-campinas-com-garagem-52m2-venda-RS415000-id-2874359004/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-nova-campinas-campinas-com-garagem-199m2-venda-RS1890000-id-2874360284/",
    "https://www.vivareal.com.br/imovel/sobrado-4-quartos-parque-taquaral-campinas-com-garagem-500m2-venda-RS3750000-id-2874360283/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-centro-campinas-com-garagem-41m2-venda-RS438000-id-2874359983/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-cambui-campinas-com-garagem-38m2-venda-RS690000-id-2874354296/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-nova-campinas-campinas-com-garagem-165m2-venda-RS2600000-id-2874359795/",
    "https://www.vivareal.com.br/imovel/sobrado-5-quartos-parque-taquaral-campinas-com-garagem-968m2-venda-RS6000000-id-2874358501/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-cambui-campinas-com-garagem-38m2-venda-RS750000-id-2874358459/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-cambui-campinas-com-garagem-74m2-venda-RS415000-id-2874357831/",
    "https://www.vivareal.com.br/imovel/apartamento-4-quartos-cambui-campinas-com-garagem-157m2-venda-RS1910000-id-2874359125/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-cambui-campinas-com-garagem-126m2-venda-RS1850000-id-2874356846/",
    "https://www.vivareal.com.br/imovel/imovel-comercial-2-quartos-cambui-campinas-com-garagem-163m2-venda-RS780000-id-2874359394/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-vila-itapura-campinas-com-garagem-145m2-venda-RS850000-id-2874359119/",
    "https://www.vivareal.com.br/imovel/sobrado-5-quartos-parque-taquaral-campinas-com-garagem-702m2-venda-RS3400000-id-2874358487/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-cambui-campinas-com-garagem-72m2-venda-RS1180000-id-2874358729/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-nova-campinas-campinas-com-garagem-125m2-venda-RS2300000-id-2874358431/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-cambui-campinas-com-garagem-43m2-venda-RS591000-id-2874359102/",
    "https://www.vivareal.com.br/imovel/apartamento-4-quartos-centro-campinas-com-garagem-136m2-venda-RS689000-id-2874359099/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-cambui-campinas-com-garagem-138m2-venda-RS1290000-id-2874359096/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-parque-taquaral-campinas-com-garagem-130m2-venda-RS1440000-id-2874359880/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-taquaral-campinas-com-garagem-46m2-venda-RS300000-id-2874354566/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-jardim-belo-horizonte-campinas-com-garagem-136m2-venda-RS1980000-id-2874359875/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-cambui-campinas-com-garagem-126m2-venda-RS1850000-id-2874358408/",
    "https://www.vivareal.com.br/imovel/lote-terreno-centro-campinas-5000m2-venda-RS180000-id-2874354816/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-jardim-nova-esperanca-campinas-com-garagem-280m2-venda-RS350000-id-2874126183/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-esmeraldina-campinas-com-garagem-40m2-venda-RS155931-id-2873989904/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-bairro-das-palmeiras-campinas-com-garagem-164m2-venda-RS1700000-id-2873985203/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-botafogo-campinas-com-garagem-44m2-venda-RS350000-id-2873990801/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-cambui-campinas-com-garagem-61m2-venda-RS574777-id-2873987874/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-vila-joao-jorge-campinas-com-garagem-102m2-venda-RS390000-id-2873983079/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-loteamento-mont-blanc-residence-campinas-com-garagem-350m2-venda-RS3800000-id-2873969796/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-jardim-proenca-campinas-com-garagem-152m2-venda-RS1199000-id-2873974675/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-vila-marieta-campinas-com-garagem-251m2-aluguel-RS9500-id-2873969213/",
    "https://www.vivareal.com.br/imovel/lote-terreno-alphaville-dom-pedro-campinas-412m2-venda-RS990000-id-2873972154/",
    "https://www.vivareal.com.br/imovel/casa-4-quartos-jardim-chapadao-campinas-com-garagem-263m2-venda-RS900000-id-2873972153/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-garcia-campinas-com-garagem-41m2-venda-RS150000-id-2873973609/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-centro-campinas-com-garagem-105m2-venda-RS695000-id-2873972515/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-jardim-nossa-senhora-auxiliadora-campinas-com-garagem-75m2-venda-RS870000-id-2873969211/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-taquaral-campinas-com-garagem-54m2-venda-RS700000-id-2873968355/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-jardim-dos-oliveiras-campinas-com-garagem-69m2-venda-RS539000-id-2873973608/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-vila-saturnia-campinas-com-garagem-57m2-aluguel-RS2800-id-2873969789/",
    "https://www.vivareal.com.br/imovel/apartamento-4-quartos-cambui-campinas-com-garagem-120m2-venda-RS1350000-id-2873968984/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-cambui-campinas-com-garagem-65m2-aluguel-RS2750-id-2873968773/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-bosque-campinas-com-garagem-60m2-aluguel-RS1300-id-2873963216/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-parque-rural-fazenda-santa-candida-campinas-com-garagem-97m2-venda-RS849120-id-2873967075/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-nova-europa-campinas-com-garagem-52m2-venda-RS445610-id-2873965125/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-loteamento-chacara-prado-campinas-com-garagem-65m2-venda-RS519200-id-2873961240/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-nova-europa-campinas-com-garagem-57m2-venda-RS434700-id-2873963544/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-4-quartos-loteamento-alphaville-campinas-campinas-com-garagem-208m2-venda-RS1449379-id-2873961334/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-vila-industrial-campinas-com-garagem-117m2-venda-RS462839-id-2873965047/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-centro-campinas-com-garagem-70m2-venda-RS319060-id-2873960126/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-cambui-campinas-com-garagem-70m2-venda-RS1049020-id-2873963364/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-vila-industrial-campinas-com-garagem-72m2-venda-RS339260-id-2873964512/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-vila-joaquim-inacio-campinas-com-garagem-140m2-venda-RS397339-id-2873962870/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-vila-industrial-campinas-com-garagem-72m2-venda-RS339470-id-2873963902/",
    "https://www.vivareal.com.br/imovel/casa-4-quartos-jardim-proenca-i-campinas-com-garagem-216m2-venda-RS798720-id-2873963007/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-cambui-campinas-com-garagem-88m2-venda-RS769200-id-2873957238/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-bosque-campinas-com-garagem-98m2-venda-RS799550-id-2873962218/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-jardim-ipiranga-campinas-com-garagem-143m2-venda-RS619179-id-2873957823/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-parque-fazendinha-campinas-com-garagem-170m2-venda-RS424370-id-2873962089/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-taquaral-campinas-com-garagem-60m2-venda-RS669460-id-2873961690/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-nova-campinas-campinas-com-garagem-60m2-venda-RS349590-id-2873961687/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-cambui-campinas-com-garagem-65m2-venda-RS724180-id-2873958372/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-centro-campinas-105m2-venda-RS419840-id-2873959202/",
    "https://www.vivareal.com.br/imovel/casa-2-quartos-botafogo-campinas-com-garagem-170m2-venda-RS519220-id-2873957602/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-4-quartos-sousas-campinas-com-garagem-374m2-venda-RS1299680-id-2873959908/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-vila-progresso-campinas-com-garagem-110m2-venda-RS1074720-id-2873959083/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-5-quartos-parque-da-hipica-campinas-com-garagem-600m2-venda-RS2499200-id-2873956649/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-parque-da-hipica-campinas-com-garagem-245m2-venda-RS1494320-id-2873959484/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-swiss-park-campinas-com-garagem-205m2-venda-RS2391279-id-2873958243/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-jardim-campos-eliseos-campinas-com-garagem-350m2-venda-RS859530-id-2873950940/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-2-quartos-vila-industrial-campinas-com-garagem-106m2-venda-RS549140-id-2873956712/",
    "https://www.vivareal.com.br/imovel/apartamento-4-quartos-cambui-campinas-com-garagem-316m2-venda-RS4499720-id-2873956260/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-bairro-das-palmeiras-campinas-com-garagem-124m2-venda-RS899680-id-2873956706/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-2-quartos-vila-castelo-branco-campinas-com-garagem-82m2-venda-RS379330-id-2873958374/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-vila-santana-campinas-com-garagem-75m2-venda-RS319760-id-2873956163/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-jardim-nova-europa-campinas-com-garagem-58m2-venda-RS559530-id-2873957899/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-loteamento-residencial-vila-bella-campinas-com-garagem-136m2-venda-RS1599450-id-2873957384/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-4-quartos-swiss-park-campinas-com-garagem-485m2-venda-RS3599521-id-2873955940/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-sao-bernardo-campinas-com-garagem-195m2-venda-RS1382680-id-2873956232/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-mansoes-santo-antonio-campinas-com-garagem-83m2-venda-RS954150-id-2873954060/",
    "https://www.vivareal.com.br/imovel/casa-2-quartos-parque-jambeiro-campinas-com-garagem-138m2-venda-RS639450-id-2873956690/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-centro-campinas-com-garagem-130m2-venda-RS649360-id-2873952340/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-2-quartos-parque-taquaral-campinas-com-garagem-85m2-venda-RS958491-id-2873955658/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-cambui-campinas-com-garagem-105m2-venda-RS749829-id-2873956119/",
    "https://www.vivareal.com.br/imovel/sobrado-4-quartos-centro-campinas-com-garagem-1600m2-venda-RS6150000-id-2873955452/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-notre-dame-campinas-com-garagem-137m2-venda-RS980000-id-2873955328/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-vila-industrial-campinas-com-garagem-138m2-venda-RS299740-id-2873955241/",
    "https://www.vivareal.com.br/imovel/apartamento-2-quartos-cambui-campinas-com-garagem-80m2-venda-RS1189070-id-2873955044/",
    "https://www.vivareal.com.br/imovel/cobertura-1-quartos-centro-campinas-com-garagem-71m2-venda-RS584420-id-2873956096/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-colinas-do-ermitage-sousas-campinas-com-garagem-340m2-venda-RS2399160-id-2873955604/",
    "https://www.vivareal.com.br/imovel/casa-10-quartos-centro-campinas-com-garagem-420m2-venda-RS2999820-id-2873955387/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-cambui-campinas-com-garagem-60m2-venda-RS588340-id-2873955578/",
    "https://www.vivareal.com.br/imovel/casa-3-quartos-vila-padre-manoel-de-nobrega-campinas-com-garagem-120m2-venda-RS584640-id-2873946942/",
    "https://www.vivareal.com.br/imovel/apartamento-1-quartos-botafogo-campinas-com-garagem-50m2-venda-RS749490-id-2873952926/",
    "https://www.vivareal.com.br/imovel/apartamento-3-quartos-centro-campinas-com-garagem-82m2-venda-RS360000-id-2873951685/",
    "https://www.vivareal.com.br/imovel/casa-de-condominio-3-quartos-parque-rural-fazenda-santa-candida-campinas-com-garagem-115m2-venda-RS1148670-id-2873953838/"
]

MESES = {
    "janeiro": 1, "fevereiro": 2, "março": 3, "marco": 3, "abril": 4, "maio": 5, "junho": 6,
    "julho": 7, "agosto": 8, "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12
}

def clean_number(text):
    if not text:
        return 0.0
    nums = re.sub(r"[^0-9,]", "", text)
    return float(nums.replace(",", ".")) if nums else 0.0

def extrair_feature_por_label(soup_obj, labels_possiveis):
    for label in labels_possiveis:
        label_tag = soup_obj.find("p", string=re.compile(rf"^\s*{label}\s*$", re.IGNORECASE))
        if label_tag:
            container_pai = label_tag.find_parent("div")
            if container_pai:
                valor_tag = container_pai.find("p", class_=re.compile("font-bold"))
                if valor_tag:
                    texto_valor = valor_tag.get_text(strip=True)
                    return clean_number(texto_valor)
    return 0.0

def extrair_data_criacao(soup):
    try:
        span = soup.find("span", {"data-testid": "listing-created-date"})
        if not span:
            return None
        texto = span.get_text(strip=True).lower()
        match = re.search(r"(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})", texto)
        if match:
            dia, mes_nome, ano = match.groups()
            mes_num = MESES.get(mes_nome, 1)
            dt = datetime(int(ano), mes_num, int(dia), 0, 0, 0, tzinfo=TZ)
            return dt.isoformat()
    except Exception:
        pass
    return None

def pick_best_from_srcset(srcset: str):
    if not srcset: return None
    best_url, best_w = None, -1
    for part in srcset.split(","):
        tokens = part.strip().split()
        if not tokens: continue
        url, w = tokens[0].strip(), 0
        if len(tokens) > 1:
            m = re.search(r"(\d+)\s*w$", tokens[1])
            if m: w = int(m.group(1))
        if w > best_w:
            best_w, best_url = w, url
    return best_url

def extract_vivareal_main_image(soup: BeautifulSoup):
    img = soup.select_one('img[data-testid="carousel-item-image"], img.carousel-photos--img')
    if img:
        for attr in ("src", "data-src", "data-lazy", "data-original", "data-image"):
            val = img.get(attr)
            if val and val.startswith("http"): return val
        best = pick_best_from_srcset(img.get("srcset", ""))
        if best: return best
        pic = img.find_parent("picture")
        if pic:
            sources = sorted(pic.find_all("source", srcset=True), key=lambda s: 0 if "webp" in (s.get("type") or "") else 1)
            for s in sources:
                best = pick_best_from_srcset(s.get("srcset", ""))
                if best: return best
    first_source = soup.select_one("picture source[srcset]")
    if first_source:
        best = pick_best_from_srcset(first_source.get("srcset", ""))
        if best: return best
    candidates = re.findall(r"https://resizedimgs\.vivareal\.com/img/[^\s\"'>]+", str(soup))
    if candidates:
        def score(u: str) -> int:
            m = re.search(r"dimension=(\d+)x(\d+)", u)
            return int(m.group(1)) * int(m.group(2)) if m else 0
        candidates.sort(key=score, reverse=True)
        return candidates[0]
    return None

def extrair_tipo_imovel(title, url):
    title_lower, url_lower = (title.lower() if title else ""), url.lower()
    if "apartamento" in title_lower or "apartamento" in url_lower: return "apartment"
    if "casa" in title_lower or "casa" in url_lower: return "house"
    return "other"

def processar_html_viva_real(session, url, attempt=1):
    print(f"\n🌍 Acessando: {url}")
    
    # Headers realistas para compor com o impersonate
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": "https://www.vivareal.com.br/venda/",
        "Sec-Ch-Ua": '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Upgrade-Insecure-Requests": "1"
    }

    try:
        # A MÁGICA ESTÁ AQUI: impersonate="chrome" engana o DataDome/Cloudflare
        resp = session.get(url, headers=headers, impersonate="chrome", timeout=20)
        
        if resp.status_code == 429:
            if attempt <= 3:
                espera_longa = attempt * random.uniform(25, 35) # Jitter até na punição
                print(f"   🛑 Bloqueio (429)! Pausando por {espera_longa:.0f}s (Tentativa {attempt}/3)...")
                time.sleep(espera_longa)
                return processar_html_viva_real(session, url, attempt + 1)
            else:
                print("   ❌ Limite de tentativas. Pule para o próximo (ou troque o IP do seu roteador/4G).")
                return

        if resp.status_code == 404:
            print("   ❌ 404: Imóvel não existe mais.")
            return
        if resp.status_code >= 400:
            print(f"   ❌ HTTP {resp.status_code}")
            return

        soup = BeautifulSoup(resp.content, "html.parser")

        # Verifica se caiu em página de captcha por segurança
        if soup.find("title") and "captcha" in soup.find("title").get_text(strip=True).lower():
            print("   ⚠️ Fomos pegos pela página de CAPTCHA. Troque seu IP.")
            return

        match_id = re.search(r"(?:-id-|/imovel/)(\d+)", url)
        ext_id = match_id.group(1) if match_id else "0"

        data_criacao = extrair_data_criacao(soup) or datetime.now(TZ).isoformat()
        title_elem = soup.find("h1", class_=re.compile("title"))
        title = title_elem.get_text(strip=True) if title_elem else ""
        img_url = extract_vivareal_main_image(soup)

        price = 0.0
        price_elem = soup.find("h3", class_=re.compile("price-info")) or soup.find("div", {"data-testid": "price-value"})
        if price_elem: price = clean_number(price_elem.get_text())

        if price == 0.0:
            img_for_alt = soup.select_one('img[data-testid="carousel-item-image"], img.carousel-photos--img')
            if img_for_alt and "R$" in img_for_alt.get("alt", ""):
                match = re.search(r"R\$\s*([\d\.,]+)", img_for_alt.get("alt", ""))
                if match: price = clean_number(match.group(1))

        if price == 0.0 and "R$" in title:
            match = re.findall(r"R\$\s*([\d\.,]+)", title)
            if match: price = clean_number(match[-1])

        address_elem = soup.find("p", {"data-testid": "location-address"})
        full_address = address_elem.get_text(strip=True) if address_elem else ""
        street, neighborhood, city, state = "", "", "Campinas", "SP"

        if full_address:
            parts = [p.strip() for p in full_address.split("-")]
            if len(parts) > 0: state = parts[-1]
            if len(parts) >= 2:
                mp = parts[-2]
                if "," in mp:
                    mp_split = [x.strip() for x in mp.split(",")]
                    city, neighborhood = mp_split[-1], mp_split[0]
                else: neighborhood = mp
            if len(parts) >= 3: street = parts[0]
            if len(parts) == 2:
                fp = parts[0]
                if "," in fp:
                    fp_split = [x.strip() for x in fp.split(",")]
                    city, neighborhood = fp_split[-1], fp_split[0]
                else: neighborhood = fp

        area = extrair_feature_por_label(soup, ["Metragem", "Área", "Área útil"])
        quartos = extrair_feature_por_label(soup, ["Quartos", "Dormitórios"])
        banheiros = extrair_feature_por_label(soup, ["Banheiros", "Banhos"])
        vagas = extrair_feature_por_label(soup, ["Vagas", "Garagem"])
        property_type = extrair_tipo_imovel(title, url)

        print(f"   🏠 OK: {property_type} | {area}m² | R$ {price}")

        payload = {
            "dedupe_key": f"vivareal_{ext_id}", "portal": "vivareal", "external_id": ext_id,
            "url": url, "title": title, "property_type": property_type, "main_image_url": img_url,
            "price": price, "area_m2": area, "bedrooms": int(quartos), "bathrooms": int(banheiros),
            "parking": int(vagas), "city": city, "neighborhood": neighborhood, "state": state,
            "published_at": data_criacao, "last_seen_at": datetime.now(TZ).isoformat(),
            "full_data": {"extracted_method": "ninja_curl_cffi_v1"}
        }

        try:
            existing = supabase.table(TABLE_NAME).select("id, published_at, first_seen_at, main_image_url").eq("portal", "vivareal").eq("external_id", ext_id).execute()
            if existing.data and len(existing.data) > 0:
                current = existing.data[0]
                payload_update = payload.copy()
                payload_update.pop("published_at", None)
                payload_update.pop("first_seen_at", None)
                if not payload_update.get("main_image_url"):
                    if current.get("main_image_url"): payload_update["main_image_url"] = current["main_image_url"]
                    else: payload_update.pop("main_image_url", None)
                supabase.table(TABLE_NAME).update(payload_update).eq("id", current["id"]).execute()
                print(f"   🔄 Atualizado com sucesso!")
            else:
                payload["first_seen_at"] = datetime.now(TZ).isoformat()
                supabase.table(TABLE_NAME).insert(payload).execute()
                print(f"   💾 Novo imóvel inserido!")
        except Exception as db_err:
            print(f"   🚨 Erro banco: {db_err}")

    except Exception as e:
        print(f"🚨 Erro geral: {e}")

if __name__ == "__main__":
    print(f"🚀 Iniciando resgate ninja para {len(links_to_scrape)} imóveis...")
    
    # Cria uma sessão global que mantém a conexão viva e simula um Chrome o tempo todo
    with requests.Session() as session:
        for index, link in enumerate(links_to_scrape):
            processar_html_viva_real(session, link)
            
            if index < len(links_to_scrape) - 1:
                espera = random.uniform(4.5, 9.2)
                print(f"   ⏳ Jitter de {espera:.1f}s...\n")
                time.sleep(espera)