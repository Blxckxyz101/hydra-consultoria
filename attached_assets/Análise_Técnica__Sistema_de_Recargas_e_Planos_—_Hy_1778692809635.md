# Análise Técnica: Sistema de Recargas e Planos — Hydra Consultoria

Esta análise foca exclusivamente no motor financeiro da plataforma: como o dinheiro entra e como os planos são apresentados. Identificamos pontos onde a mecânica atual pode estar "deixando dinheiro na mesa".

## 1. O Sistema de Recargas (Fluxo de Pagamento)
O fluxo de "Adicionar Saldo" é moderno e utiliza checkout transparente com PIX automático. No entanto, existem melhorias mecânicas que podem aumentar a conversão:

| Elemento | Observação Técnica | Melhoria de Alta Conversão |
|---|---|---|
| **Seleção de Valores** | Botões fixos (R$50, R$100, etc.) e campo personalizado. | **Gatilho de Bônus:** Adicionar uma label em cima dos botões maiores (ex: R$200) dizendo "+10% de Bônus". Isso empurra o cliente para tickets maiores. |
| **Tela do QR Code** | Funcional, com timer de 3 minutos e botão "Copiar". | **Prova Social no Checkout:** Adicionar um texto discreto abaixo do QR Code: *"Seu saldo será creditado em média em 15 segundos"*. Isso reduz a ansiedade do cliente. |
| **Histórico de Transações** | Atualmente vazio para novos usuários. | **Gamificação:** Mostrar uma barra de progresso de "Nível de Investidor" baseada no total já recarregado. Clientes amam subir de nível. |

## 2. Apresentação dos Planos (Psicologia de Vendas)
A tabela de planos na carteira é o principal ponto de decisão. Pequenas mudanças visuais aqui geram grandes mudanças no faturamento.

*   **Ancoragem Visual:** O plano "Padrão" (R$ 89,90) já tem a badge "MELHOR CUSTO", o que é excelente. Para potencializar, o plano "Micro" (R$ 19,90) deve parecer "caro" em comparação. Exibir o custo por consulta de forma mais agressiva:
    *   Micro: **R$ 0,99** / consulta
    *   Padrão: **R$ 0,75** / consulta (Economia de 25%)
*   **Destaque do Plano Pro:** O plano de R$ 399,90 deve ser apresentado como a escolha para "Agências e Profissionais", criando uma segmentação clara.

## 3. Mecânica de Retenção e Recompra
Como garantir que o cliente recarregue assim que o saldo acabar:

*   **Aviso de "Saldo Crítico":** Quando o usuário atinge 10% do saldo restante, o sistema deve exibir um alerta visual no topo do painel com um link direto para a página de recarga.
*   **Cupom de Recompra:** Se o usuário gastar todo o saldo em menos de 24h, oferecer um cupom automático de 5% para a próxima recarga nas próximas 2 horas. Isso aproveita o "momentum" de uso do cliente.

## 4. O que falta no Visual e Mecânica (O Essencial)
*   **Mobile Layout:** A modal de "Adicionar Saldo" precisa ser 100% otimizada para dedos grandes no celular. O botão "GERAR PIX" deve ser o elemento mais chamativo da tela.
*   **Feedback Instantâneo:** Assim que o PIX é pago, a tela deve mudar para uma animação de "Sucesso! Saldo Creditado" com um botão "Ir para Consultas". Isso gera dopamina no cliente e valida a compra instantaneamente.

---
**Conclusão:** O sistema de recargas da Hydra é sólido, mas pode ser muito mais agressivo na indução de tickets maiores. O foco deve ser em **recompensar quem gasta mais** e **facilitar ao máximo o ato de pagar**.
