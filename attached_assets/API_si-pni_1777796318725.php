<?php
/*
 * --------------------------------------------------------------------
 * ATENÇÃO, KIBADORES!
 * Desenvolvido por: @zBL4CKHATOFICIAL
 * Data: 26/08/2024
 * --------------------------------------------------------------------
 * Este código é resultado de trabalho árduo e dedicação. Se você está
 * utilizando este código, lembre-se de manter os créditos intactos.
 * Remover ou modificar os créditos é desrespeitoso e desonesto.
 * --------------------------------------------------------------------
 * Faça o seu trabalho corretamente: dê o crédito devido ao autor.
 * O esforço de cada desenvolvedor merece respeito. Se você está
 * copiando, ao menos tenha a decência de reconhecer o trabalho alheio.
 * --------------------------------------------------------------------
 */
?>
<?php

function processar_cpf($cpf) {
    //
    $credentials = 'EMAIL AQUI :SENHA AQUI';
    $credentials_base64 = base64_encode($credentials);
    $url_login = 'https://servicos-cloud.saude.gov.br/pni-bff/v1/autenticacao/tokenAcesso';
    $url_pesquisa_base = 'https://servicos-cloud.saude.gov.br/pni-bff/v1/cidadao/cpf/';
    $headers_login = [
        "Host: servicos-cloud.saude.gov.br",
        "Connection: keep-alive",
        "Content-Length: 0",
        "sec-ch-ua: \"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"114\", \"Google Chrome\";v=\"114\"",
        "accept: application/json",
        "X-Authorization: Basic $credentials_base64",
        "sec-ch-ua-mobile: ?0",
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "sec-ch-ua-platform: Windows",
        "Origin: https://si-pni.saude.gov.br",
        "Sec-Fetch-Site: same-site",
        "Sec-Fetch-Mode: cors",
        "Sec-Fetch-Dest: empty",
        "Referer: https://si-pni.saude.gov.br/",
        "Accept-Encoding: gzip, deflate, br",
        "Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
    ];
    $max_retries = 3; 
    $retry_delay = 5; 
    for ($i = 0; $i < $max_retries; $i++) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url_login);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers_login);
        curl_setopt($ch, CURLOPT_POST, 1);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
        $response_login = curl_exec($ch);
        if ($response_login === false) {
            curl_close($ch);
            sleep($retry_delay); 
            continue;
        }
        curl_close($ch);
        $login_data = json_decode($response_login, true);
        if (isset($login_data['accessToken'])) {
            $token_acesso = $login_data['accessToken'];
            $url_pesquisa = $url_pesquisa_base . $cpf;
            $headers_pesquisa = [
                'Host: servicos-cloud.saude.gov.br',
                "Authorization: Bearer $token_acesso",
                'Accept: application/json, text/plain, */*',
                'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                'Origin: https://si-pni.saude.gov.br',
                'Sec-Fetch-Site: same-site',
                'Sec-Fetch-Mode: cors',
                'Sec-Fetch-Dest: empty',
                'Referer: https://si-pni.saude.gov.br/',
                'Accept-Encoding: gzip, deflate, br',
                'Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
            ];
            
            for ($j = 0; $j < $max_retries; $j++) {
                $ch = curl_init();
                curl_setopt($ch, CURLOPT_URL, $url_pesquisa);
                curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
                curl_setopt($ch, CURLOPT_HTTPHEADER, $headers_pesquisa);
                curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
                curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
                $response_pesquisa = curl_exec($ch);
                if ($response_pesquisa === false) {
                    curl_close($ch);
                    sleep($retry_delay);
                    continue;
                }
                curl_close($ch);
                $dados_pessoais = json_decode($response_pesquisa, true);
                if (isset($dados_pessoais['records'])) {
                    return formatar_informacoes($dados_pessoais['records'][0]);
                } else {
                    return json_encode(["error" => "Erro na pesquisa", "details" => $response_pesquisa]);
                }
            }
            return json_encode(["error" => "Falha na requisição de pesquisa após várias tentativas"]);
        } else {
            return json_encode(["error" => "Erro no login", "details" => $response_login]);
        }
    }
    return json_encode(["error" => "Falha na requisição de login após várias tentativas"]);
}

function formatar_informacoes($dados_pessoais) {
    return json_encode([
        'nome' => $dados_pessoais['nome'] ?? null,
        'dataNascimento' => $dados_pessoais['dataNascimento'] ?? null,
        'sexo' => $dados_pessoais['sexo'] ?? null,
        'nomeMae' => $dados_pessoais['nomeMae'] ?? null,
        'nomePai' => $dados_pessoais['nomePai'] ?? null,
        'grauQualidade' => $dados_pessoais['grauQualidade'] ?? null,
        'ativo' => $dados_pessoais['ativo'] ?? null,
        'obito' => $dados_pessoais['obito'] ?? null,
        'partoGemelar' => $dados_pessoais['partoGemelar'] ?? null,
        'vip' => $dados_pessoais['vip'] ?? null,
        'racaCor' => $dados_pessoais['racaCor'] ?? null,
        'telefone' => $dados_pessoais['telefone'] ?? null,
        'nacionalidade' => $dados_pessoais['nacionalidade'] ?? null,
        'endereco' => $dados_pessoais['endereco'] ?? null,
    ]);
}

header('Content-Type: application/json');


if (isset($_GET['cpf'])) {
    $cpf = $_GET['cpf'];
    echo processar_cpf($cpf);
} else {
    echo json_encode(["error" => "Por favor, forneça o CPF na URL como ?cpf=seu_cpf"]);
}
?>