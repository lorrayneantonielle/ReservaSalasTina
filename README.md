# Casa Tina Martins — Agendamento de Espaços

Sistema de reserva dos espaços da Casa Tina Martins, com custo zero:

- **Backend:** Google Apps Script publicado como Web App, lendo e gravando direto na planilha de agenda.
- **Frontend:** Vue 3 + Vite + Tailwind CSS, publicado no GitHub Pages via GitHub Actions.

O público só consegue **consultar** a agenda e **criar** reservas. Editar e cancelar continua sendo feito manualmente
na planilha pela administração.

```
apps-script/
  Code.gs              Backend (doGet / doPost)
  appsscript.json      Manifesto (fuso America/Sao_Paulo, Web App público)
src/
  App.vue              Página, filtros de data/espaço e botão "+ Reservar Espaço"
  components/
    AgendaView.vue     Grade do dia (desktop) e cards por espaço (celular)
    BookingModal.vue   Formulário de reserva, validações e alertas
    Icone.vue
  constants/agenda.js  Espaços, cores e horário de funcionamento
  services/api.js      Comunicação com o Apps Script
  services/mock.js     Backend fictício do modo demonstração
  utils/tempo.js       Datas, horários e máscara de telefone
.github/workflows/deploy.yml
```

---

## 1. Preparar a planilha

### Abas dos meses

Uma aba por mês, com o nome do mês em português: `Janeiro`, `Fevereiro`, `Março`, `Abril`, `Maio`, `Junho`, `Julho`,
`Agosto`, `Setembro`, `Outubro`, `Novembro`, `Dezembro`.

- Maiúsculas/minúsculas e acentos não importam (`NOVEMBRO`, `Marco` e `Março` funcionam).
- Também é aceito o ano no nome (`Novembro 2026`, `Novembro/2026`). Abas com ano têm prioridade.
- Para abas sem ano, o script confere a coluna **DIA DA SEMANA** com o calendário. Assim, a aba `Janeiro` de 2026
  não recebe reservas de janeiro de 2027: quando virar o ano, crie a aba nova (ou renomeie a antiga, ex. `Janeiro 2026`).
- Se a aba de um mês não existir, o site mostra "Agenda ainda não aberta" e não aceita reservas para ele.

### Estrutura de cada aba

O cabeçalho fica na linha 2 (a linha 1 pode ter um título). As colunas são localizadas pelo texto do cabeçalho; se não
forem encontradas, vale a ordem A–H abaixo:

| Col. | Cabeçalho |
| --- | --- |
| A | `DATA` |
| B | `DIA DA SEMANA` |
| C | `HORÁRIO` |
| D | `ATIVIDADE (informar se é interna ou externa)` |
| E | `TEMPO DE DURAÇÃO DA ATIVIDADE` |
| F | `ESPAÇO EM QUE A ATIVIDADE ACONTECE` |
| G | `RESPONSÁVEL PELA ATIVIDADE (nome, telefone de contato)` |
| H | `OBSERVAÇÕES` |

Como o script lê os dados:

- **Blocos de dia:** o número do dia (`13`) só precisa estar na primeira linha do bloco (pode ser célula mesclada).
  As linhas seguintes pertencem a esse dia até aparecer o próximo número. O mesmo vale para as faixas de **HORÁRIO**
  (`8h-12h`, `12h-14h`, `14h-18h`, `18h-22h`) e suas linhas intercaladas.
- **O que é uma reserva:** linha com **ESPAÇO** preenchido e **TEMPO DE DURAÇÃO** (ou **ATIVIDADE**) preenchido.
- **Horários aceitos em "TEMPO DE DURAÇÃO":** `14h - 19h`, `9h às 13h`, `14h30-16h`, `14:00 - 19:00`, `dia todo`.
  Se o texto não puder ser lido, vale a faixa da coluna HORÁRIO; se nem isso existir, o espaço fica bloqueado o dia
  inteiro (melhor bloquear do que permitir duas reservas no mesmo horário).
- **Nomes dos espaços:** o texto é reconhecido por palavra-chave (`atendimento`, `eliana`, `valdete`, `galpão`,
  `cozinha`, `garagem`). Uma linha com `Galpão e Cozinha` bloqueia os dois. `Casa toda` ou `Todos os espaços` bloqueia
  todos.

Onde o sistema grava uma reserva nova (sem nunca sobrescrever nada):

1. Primeira linha vazia na faixa de HORÁRIO que contém o horário de início;
2. Se essa faixa estiver cheia, insere uma linha dentro dela (herdando a formatação);
3. Se o horário não cair em nenhuma faixa, usa a primeira linha vazia do dia ou insere uma linha no bloco do dia.

Ela é gravada assim, com uma nota "Reserva feita pelo sistema online em…" na célula da atividade:

- `ATIVIDADE`: `Ensaio do coral (Externa)`
- `TEMPO DE DURAÇÃO`: `19:00 - 21:00` (para gravar `19h - 21h`, use `FORMATO_TEMPO: 'h'` no `CONFIG`)
- `ESPAÇO`: `Sala Valdete Guerra`
- `RESPONSÁVEL`: `Maria Souza (31 97777-0000)`
- `OBSERVAÇÕES`: texto informado

> Os dias do mês precisam existir na aba. Se o dia pedido não estiver lá, a reserva é recusada com uma mensagem para
> procurar a administração.

---

## 2. Publicar o Apps Script (Web App)

1. Abra a planilha > **Extensões > Apps Script**.
2. Apague o conteúdo de `Código.gs` e cole o conteúdo de [`apps-script/Code.gs`](apps-script/Code.gs).
3. Em **Configurações do projeto** (engrenagem), marque *"Mostrar arquivo de manifesto appsscript.json"* e substitua
   o conteúdo dele pelo de [`apps-script/appsscript.json`](apps-script/appsscript.json). Isso garante o fuso
   `America/Sao_Paulo`.
4. No editor, selecione a função `testarEstrutura` e clique em **Executar**. Autorize o acesso à planilha. O log
   mostra a aba encontrada, a linha do cabeçalho e como cada linha foi interpretada. `testarLeitura` mostra o JSON
   que o site recebe.
5. **Implantar > Nova implantação** > tipo **App da Web**:
   - Descrição: `v1`
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
6. Copie a URL que termina em `/exec`. Teste no navegador: `.../exec?mes=11&ano=2026`.

**Ao alterar o código depois:** use **Implantar > Gerenciar implantações > Editar (lápis) > Versão: Nova versão**.
Assim a URL continua a mesma. Criar uma "Nova implantação" gera outra URL.

> Contas Google Workspace de organizações podem bloquear o acesso "Qualquer pessoa". Nesse caso, publique o script a
> partir de uma conta Gmail pessoal que seja editora da planilha.

### Ajustes opcionais (`CONFIG` no topo do `Code.gs`)

| Opção | Padrão | Para que serve |
| --- | --- | --- |
| `SPREADSHEET_ID` | `''` | ID da planilha, se o script não estiver vinculado a ela |
| `HORA_MIN` / `HORA_MAX` | `07:00` / `23:00` | Janela de reservas (mantenha igual a `src/constants/agenda.js`) |
| `FORMATO_TEMPO` | `'HH:mm'` | `'h'` grava `14h - 19h` em vez de `14:00 - 19:00` |
| `ANTECEDENCIA_MAXIMA_DIAS` | `365` | Até quantos dias à frente se pode reservar |
| `REGISTRAR_NOTA` | `true` | Adiciona a nota de origem na célula |

### Contrato da API

`GET ?mes=11&ano=2026` (ou `?data=2026-11-13`):

```json
{
  "success": true, "mes": 11, "ano": 2026, "aba": "Novembro", "total": 1,
  "reservas": [
    { "data": "2026-11-13", "espaco": "Sala Valdete Guerra", "horario": "14h - 19h",
      "horaInicio": "14:00", "horaFim": "19:00", "atividade": "Sarau Novembro Negro", "responsavel": "Pedro" }
  ]
}
```

Telefones e e-mails são removidos do campo `responsavel`. Se a aba não existir, a resposta é
`{ "success": false, "code": "ABA_NAO_ENCONTRADA", "message": "..." }`.

`POST` (corpo JSON, enviado como `text/plain` para evitar o preflight de CORS, que o Apps Script não suporta):

```json
{ "data": "2026-11-13", "espaco": "Galpão", "horaInicio": "09:00", "horaFim": "12:00",
  "atividade": "Oficina (Externa)", "responsavelNome": "Ana", "responsavelContato": "(31) 98888-7777",
  "observacoes": "" }
```

Respostas: `{ success: true, message: "Reserva realizada com sucesso!" }` ou `{ success: false, code, message }`, com
`code` igual a `CONFLITO` (inclui `conflito: { horaInicio, horaFim, atividade }`), `VALIDACAO`, `ABA_NAO_ENCONTRADA`,
`DIA_NAO_ENCONTRADO`, `SISTEMA_OCUPADO` ou `ERRO_INTERNO`.

A gravação roda dentro de `LockService.getScriptLock()` (espera de até 15 s), e a leitura da planilha para checar
conflito acontece dentro do lock. Assim, duas pessoas reservando o mesmo horário ao mesmo tempo nunca são aceitas
juntas.

---

## 3. Rodar localmente

Requisitos: Node.js 20 ou superior.

```bash
npm install
cp .env.example .env     # no Windows: copy .env.example .env
# edite .env e cole a URL /exec em VITE_API_URL
npm run dev              # http://localhost:5173
```

Sem `VITE_API_URL`, o site roda em **modo demonstração**: mostra uma faixa amarela de aviso e usa reservas fictícias
salvas só no navegador. Serve para mexer no visual sem tocar na planilha real.

Para conferir o build de produção: `npm run build && npm run preview`.

---

## 4. Publicar no GitHub Pages

1. Crie um repositório no GitHub (ex.: `ReservaSalasTina`) e envie o código para a branch `main`:
   ```bash
   git init -b main
   git add .
   git commit -m "Sistema de agendamento da Casa Tina Martins"
   git remote add origin https://github.com/<usuario>/<repositorio>.git
   git push -u origin main
   ```
2. No repositório: **Settings > Pages > Build and deployment > Source: GitHub Actions**.
3. **Settings > Secrets and variables > Actions > aba Variables > New repository variable**:
   - Nome: `VITE_API_URL`
   - Valor: a URL `/exec` do Web App

   (Também funciona como *Secret*. A URL acaba visível no JavaScript do site de qualquer forma, então *Variable* basta.)
4. Faça um push na `main` ou rode o workflow manualmente em **Actions > Deploy no GitHub Pages > Run workflow**.
5. O site fica em `https://<usuario>.github.io/<repositorio>/`.

O `base` do Vite é definido automaticamente a partir do nome do repositório (`GITHUB_REPOSITORY`) durante o build no
Actions. Para builds locais de produção, o padrão é `/ReservaSalasTina/` (ajuste `NOME_DO_REPOSITORIO` em
`vite.config.js` se o repositório tiver outro nome). Com domínio próprio ou repositório `<usuario>.github.io`, troque o
`base` para `'/'`.

O workflow falha de propósito se `VITE_API_URL` não estiver definida, para não publicar o site em modo demonstração.

---

## Manutenção

- **Cancelar uma reserva:** apague o conteúdo da linha (colunas D–H) na planilha. O horário volta a ficar livre no site.
- **Adicionar/renomear um espaço:** altere `ESPACOS` no `Code.gs` (nome + palavra-chave) e em
  `src/constants/agenda.js` (nome + cores). Os nomes devem ser idênticos nos dois lugares.
- **Mudar o horário de funcionamento:** `HORA_MIN`/`HORA_MAX` no `Code.gs` e `HORA_ABERTURA`/`HORA_FECHAMENTO` em
  `src/constants/agenda.js`.
