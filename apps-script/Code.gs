/**
 * ============================================================================
 *  CASA TINA MARTINS — Sistema de Agendamento de Salas
 *  Backend: Google Apps Script (Web App)
 * ============================================================================
 *
 *  Publicação: Implantar > Nova implantação > Tipo "App da Web"
 *    - Executar como: Eu
 *    - Quem pode acessar: Qualquer pessoa
 *
 *  Endpoints
 *    GET  ?mes=11&ano=2026   -> todas as reservas do mês
 *    GET  ?data=2026-11-13   -> reservas de um único dia
 *    POST (corpo JSON)       -> cria uma nova reserva
 *
 *  Regras de segurança
 *    - O sistema SOMENTE INSERE reservas. Ele nunca altera nem apaga linhas
 *      já preenchidas: grava apenas em linhas totalmente vazias do bloco do
 *      dia ou insere uma linha nova nesse bloco.
 *    - Cancelamentos e edições são feitos manualmente na planilha.
 *    - Telefones/contatos nunca são devolvidos pelo GET público.
 *    - LockService serializa as gravações para evitar reservas simultâneas
 *      no mesmo espaço/horário.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
//  CONFIGURAÇÃO
// ---------------------------------------------------------------------------

const CONFIG = {
  // Deixe vazio se o script foi criado pela própria planilha
  // (Extensões > Apps Script). Caso contrário, informe o ID da planilha.
  SPREADSHEET_ID: '',

  // Linha do cabeçalho usada caso a detecção automática não encontre.
  LINHA_CABECALHO_PADRAO: 2,

  // Tempo máximo de espera pelo bloqueio de concorrência.
  LOCK_TIMEOUT_MS: 15000,

  // Janela de funcionamento aceita para reservas (manter igual ao frontend).
  HORA_MIN: '07:00',
  HORA_MAX: '23:00',

  PERMITIR_DATAS_PASSADAS: false,
  ANTECEDENCIA_MAXIMA_DIAS: 365,

  // Formato gravado em "TEMPO DE DURAÇÃO DA ATIVIDADE":
  //   'HH:mm' -> "14:00 - 19:00"      'h' -> "14h - 19h" / "14h30 - 16h"
  FORMATO_TEMPO: 'HH:mm',

  // Adiciona uma nota na célula da atividade informando que veio do sistema.
  REGISTRAR_NOTA: true,

  LIMITES: {
    atividade: 300,
    responsavelNome: 120,
    responsavelContato: 40,
    observacoes: 500,
  },
};

/** Espaços fixos da Casa. `chaves` são usadas para reconhecer o espaço em
 *  textos digitados manualmente na planilha (sem acento, minúsculo). */
const ESPACOS = [
  { nome: 'Sala Eliana Silva', chaves: ['eliana'] },
  { nome: 'Sala Valdete Guerra', chaves: ['valdete'] },
  { nome: 'Galpão', chaves: ['galpao'] },
  { nome: 'Cozinha', chaves: ['cozinha'] },
  { nome: 'Garagem', chaves: ['garagem'] },
];

/** Textos que, na planilha, significam que a Casa inteira está ocupada. */
const CHAVES_TODOS_OS_ESPACOS = ['casa toda', 'casa inteira', 'todos os espacos', 'todas as salas'];

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const DIAS_SEMANA = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];

/** Posição (0 = coluna A) das colunas caso o cabeçalho não seja detectado. */
const COLUNAS_PADRAO = {
  data: 0,
  diaSemana: 1,
  horario: 2,
  atividade: 3,
  tempo: 4,
  espaco: 5,
  responsavel: 6,
  observacoes: 7,
};

// ---------------------------------------------------------------------------
//  ENDPOINT GET — consulta de disponibilidade
// ---------------------------------------------------------------------------

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const hoje = hojeNoFuso();
    let ano;
    let mes;
    let dia = null;

    if (p.data) {
      const d = interpretarDataISO(p.data);
      if (!d) {
        return respostaJson({ success: false, code: 'PARAMETRO_INVALIDO', message: 'Parâmetro "data" inválido. Use AAAA-MM-DD.' });
      }
      ano = d.ano;
      mes = d.mes;
      dia = d.dia;
    } else {
      mes = p.mes ? interpretarMes(p.mes) : hoje.mes;
      ano = p.ano ? parseInt(p.ano, 10) : hoje.ano;
      if (!mes || !ano || ano < 2000 || ano > 2100) {
        return respostaJson({ success: false, code: 'PARAMETRO_INVALIDO', message: 'Parâmetros "mes" e/ou "ano" inválidos.' });
      }
    }

    const agenda = localizarAgendaDoMes(mes, ano);
    if (!agenda) {
      return respostaJson({
        success: false,
        code: 'ABA_NAO_ENCONTRADA',
        message: `A agenda de ${MESES[mes - 1]} de ${ano} ainda não foi aberta para reservas.`,
        mes,
        ano,
      });
    }

    let reservas = extrairReservas(agenda.estrutura, mes, ano);
    if (dia) reservas = reservas.filter((r) => r.dia === dia);

    return respostaJson({
      success: true,
      mes,
      ano,
      aba: agenda.aba.getName(),
      total: reservas.length,
      reservas: reservas.map(paraFormatoPublico),
    });
  } catch (err) {
    console.error('doGet', err && err.stack ? err.stack : err);
    return respostaJson({ success: false, code: 'ERRO_INTERNO', message: 'Erro ao consultar a agenda. Tente novamente em instantes.' });
  }
}

// ---------------------------------------------------------------------------
//  ENDPOINT POST — criação de reserva (somente inserção)
// ---------------------------------------------------------------------------

function doPost(e) {
  let entrada;
  try {
    entrada = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return respostaJson({ success: false, code: 'JSON_INVALIDO', message: 'Requisição inválida.' });
  }

  // Campo "armadilha" invisível no formulário: só robôs o preenchem.
  if (entrada && entrada.website) {
    return respostaJson({ success: true, message: 'Reserva realizada com sucesso!' });
  }

  const validacao = validarReserva(entrada || {});
  if (!validacao.ok) {
    return respostaJson({ success: false, code: 'VALIDACAO', message: validacao.message });
  }
  const r = validacao.reserva;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
    return respostaJson({
      success: false,
      code: 'SISTEMA_OCUPADO',
      message: 'Muitas reservas sendo feitas ao mesmo tempo. Aguarde alguns segundos e tente novamente.',
    });
  }

  try {
    // A leitura acontece DENTRO do lock: assim a verificação de conflito
    // sempre enxerga as reservas gravadas por requisições anteriores.
    const agenda = localizarAgendaDoMes(r.mes, r.ano);
    if (!agenda) {
      return respostaJson({
        success: false,
        code: 'ABA_NAO_ENCONTRADA',
        message: `A agenda de ${MESES[r.mes - 1]} de ${r.ano} ainda não foi aberta para reservas.`,
      });
    }

    const { aba, estrutura } = agenda;
    const linhasDoDia = estrutura.linhas.filter((l) => l.dia === r.dia);
    if (!linhasDoDia.length) {
      return respostaJson({
        success: false,
        code: 'DIA_NAO_ENCONTRADO',
        message: `O dia ${r.dia} não foi encontrado na aba "${aba.getName()}". Fale com a administração da Casa.`,
      });
    }

    const conflito = extrairReservas(estrutura, r.mes, r.ano).find((x) =>
      x.dia === r.dia &&
      x.espaco === r.espaco &&
      intervalosSeSobrepoem(r.inicioMin, r.fimMin, x.inicioMin, x.fimMin));

    if (conflito) {
      const publico = paraFormatoPublico(conflito);
      return respostaJson({
        success: false,
        code: 'CONFLITO',
        message: 'O espaço selecionado já possui reserva neste horário.',
        conflito: {
          horaInicio: publico.horaInicio,
          horaFim: publico.horaFim,
          horario: publico.horario,
          atividade: publico.atividade,
        },
      });
    }

    const linha = escolherLinhaParaGravacao(aba, linhasDoDia, r);
    gravarReserva(aba, estrutura.colunas, linha, r);
    SpreadsheetApp.flush();

    return respostaJson({
      success: true,
      message: 'Reserva realizada com sucesso!',
      reserva: {
        data: r.data,
        espaco: r.espaco,
        horaInicio: r.horaInicio,
        horaFim: r.horaFim,
        atividade: r.atividade,
      },
    });
  } catch (err) {
    console.error('doPost', err && err.stack ? err.stack : err);
    return respostaJson({ success: false, code: 'ERRO_INTERNO', message: 'Não foi possível registrar a reserva. Tente novamente.' });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
//  MAPEAMENTO DE DATAS E ABAS
// ---------------------------------------------------------------------------

/** Nome da aba de um mês (1-12). Ex.: 11 -> "Novembro". */
function nomeDaAbaDoMes(mes) {
  return MESES[mes - 1];
}

/**
 * Converte "2026-11-13" em { nomeAba: "Novembro", dia: 13, mes: 11, ano: 2026,
 * diaSemana: "SEXTA" }. Retorna null se a data for inválida.
 */
function mapearDataParaAba(dataISO) {
  const d = interpretarDataISO(dataISO);
  if (!d) return null;
  return {
    nomeAba: nomeDaAbaDoMes(d.mes),
    dia: d.dia,
    mes: d.mes,
    ano: d.ano,
    diaSemana: DIAS_SEMANA[d.diaSemana],
  };
}

/**
 * Procura a aba do mês. Aceita nomes como "Novembro", "NOVEMBRO",
 * "Novembro 2026", "Novembro/2026" (sem diferenciar acentos/maiúsculas).
 * Abas com o ano no nome têm prioridade. Para abas sem ano, os dias da
 * semana da planilha são conferidos com o calendário para garantir que a
 * aba corresponde ao ano pedido (evita gravar 2027 na aba de 2026).
 */
function localizarAgendaDoMes(mes, ano) {
  const planilha = obterPlanilha();
  const nomeMes = normalizar(nomeDaAbaDoMes(mes));
  const anoCurto = String(ano).slice(2);
  const nomesComAno = [
    `${nomeMes} ${ano}`, `${nomeMes}/${ano}`, `${nomeMes}-${ano}`, `${nomeMes} - ${ano}`,
    `${nomeMes} de ${ano}`, `${nomeMes}/${anoCurto}`, `${nomeMes} ${anoCurto}`,
  ];

  const abas = planilha.getSheets().map((aba) => ({ aba, nome: normalizar(aba.getName()) }));
  const candidatas = abas
    .filter((x) => nomesComAno.indexOf(x.nome) !== -1)
    .concat(abas.filter((x) => x.nome === nomeMes));

  for (let i = 0; i < candidatas.length; i++) {
    const estrutura = lerEstrutura(candidatas[i].aba);
    if (abaCorrespondeAoAno(estrutura, mes, ano)) {
      return { aba: candidatas[i].aba, estrutura };
    }
  }
  return null;
}

function abaCorrespondeAoAno(estrutura, mes, ano) {
  const amostras = estrutura.linhas.filter((l) => l.inicioDoDia && l.diaSemanaTexto).slice(0, 7);
  if (!amostras.length) return true;

  const acertos = amostras.filter((l) => {
    const esperado = normalizar(DIAS_SEMANA[new Date(Date.UTC(ano, mes - 1, l.dia)).getUTCDay()]).slice(0, 3);
    return normalizar(l.diaSemanaTexto).slice(0, 3) === esperado;
  }).length;

  // Maioria simples: tolera algum erro de digitação na coluna DIA DA SEMANA.
  return acertos * 2 >= amostras.length;
}

function obterPlanilha() {
  return CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

// ---------------------------------------------------------------------------
//  LEITURA DA PLANILHA
// ---------------------------------------------------------------------------

/**
 * Lê a aba e devolve { linhaCabecalho, colunas, linhas[] }.
 * Cada linha recebe o `dia` e a faixa de `horario` "herdados" das linhas de
 * cima, já que na planilha o número do dia e a faixa (8h-12h...) costumam
 * aparecer só na primeira linha do bloco (ou em células mescladas).
 */
function lerEstrutura(aba) {
  const ultimaLinha = aba.getLastRow();
  const largura = Math.min(Math.max(aba.getLastColumn(), 8), aba.getMaxColumns());

  let linhaCabecalho = CONFIG.LINHA_CABECALHO_PADRAO;
  let colunas = COLUNAS_PADRAO;

  if (ultimaLinha > 0) {
    const topo = aba.getRange(1, 1, Math.min(ultimaLinha, 10), largura).getDisplayValues();
    for (let i = 0; i < topo.length; i++) {
      const mapa = mapearColunas(topo[i]);
      if (mapa) {
        linhaCabecalho = i + 1;
        colunas = mapa;
        break;
      }
    }
  }

  const primeiraLinha = linhaCabecalho + 1;
  if (ultimaLinha < primeiraLinha) return { linhaCabecalho, colunas, linhas: [] };

  const intervalo = aba.getRange(primeiraLinha, 1, ultimaLinha - primeiraLinha + 1, largura);
  const valores = intervalo.getValues();
  const textos = intervalo.getDisplayValues();

  const linhas = [];
  let diaAtual = null;
  let faixaAtual = '';

  for (let i = 0; i < textos.length; i++) {
    const t = textos[i];
    const cel = (indice) => String(t[indice] == null ? '' : t[indice]).trim();

    const dia = extrairDia(valores[i][colunas.data], t[colunas.data]);
    if (dia) {
      diaAtual = dia;
      faixaAtual = '';
    }
    if (cel(colunas.horario)) faixaAtual = cel(colunas.horario);

    linhas.push({
      linha: primeiraLinha + i,
      dia: diaAtual,
      inicioDoDia: Boolean(dia),
      diaSemanaTexto: dia ? cel(colunas.diaSemana) : '',
      faixa: faixaAtual,
      atividade: cel(colunas.atividade),
      tempo: cel(colunas.tempo),
      espaco: cel(colunas.espaco),
      responsavel: cel(colunas.responsavel),
      observacoes: cel(colunas.observacoes),
    });
  }

  return { linhaCabecalho, colunas, linhas };
}

/** Identifica a linha de cabeçalho e a posição de cada coluna. */
function mapearColunas(celulas) {
  const n = celulas.map(normalizar);
  const achar = (teste) => n.findIndex(teste);

  const espaco = achar((c) => c.indexOf('espaco') === 0);
  const tempo = achar((c) => c.indexOf('tempo') === 0);
  if (espaco < 0 || tempo < 0) return null;

  const ou = (indice, padrao) => (indice >= 0 ? indice : padrao);
  return {
    data: ou(achar((c) => c === 'data' || c.indexOf('data ') === 0), COLUNAS_PADRAO.data),
    diaSemana: ou(achar((c) => c.indexOf('dia da semana') === 0), COLUNAS_PADRAO.diaSemana),
    horario: ou(achar((c) => c.indexOf('horario') === 0), COLUNAS_PADRAO.horario),
    atividade: ou(achar((c) => c.indexOf('atividade') === 0), COLUNAS_PADRAO.atividade),
    tempo,
    espaco,
    responsavel: ou(achar((c) => c.indexOf('responsavel') === 0), COLUNAS_PADRAO.responsavel),
    observacoes: ou(achar((c) => c.indexOf('observac') === 0), COLUNAS_PADRAO.observacoes),
  };
}

/** Lê o número do dia da coluna DATA (aceita 13, "13", 13/11/2026 ou Date). */
function extrairDia(valor, texto) {
  if (valor instanceof Date) return valor.getDate();
  const m = String(texto == null ? '' : texto).trim().match(/^(\d{1,2})(?:\D|$)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 31 ? n : null;
}

/**
 * Converte as linhas preenchidas em reservas. Uma linha é considerada
 * reserva quando tem ESPAÇO e (TEMPO ou ATIVIDADE) preenchidos.
 * O horário vem de "TEMPO DE DURAÇÃO"; se não puder ser lido, usa a faixa da
 * coluna HORÁRIO; em último caso, considera o dia todo (postura
 * conservadora para nunca permitir sobreposição).
 */
function extrairReservas(estrutura, mes, ano) {
  const reservas = [];

  estrutura.linhas.forEach((l) => {
    if (!l.dia || !l.espaco || !(l.tempo || l.atividade)) return;

    const intervalo = interpretarIntervalo(l.tempo) ||
      interpretarIntervalo(l.faixa) ||
      { inicio: 0, fim: 24 * 60 };

    const reconhecidos = identificarEspacos(l.espaco);
    const espacos = reconhecidos.length ? reconhecidos : [l.espaco];

    espacos.forEach((espaco) => {
      reservas.push({
        linha: l.linha,
        dia: l.dia,
        data: dataISO(ano, mes, l.dia),
        espaco,
        horario: l.tempo || l.faixa,
        inicioMin: intervalo.inicio,
        fimMin: intervalo.fim,
        atividade: l.atividade,
        responsavel: l.responsavel,
      });
    });
  });

  return reservas;
}

/** Remove dados internos/sensíveis antes de devolver ao público. */
function paraFormatoPublico(r) {
  return {
    data: r.data,
    espaco: r.espaco,
    horario: r.horario,
    horaInicio: minutosParaHora(r.inicioMin),
    horaFim: minutosParaHora(r.fimMin),
    atividade: r.atividade,
    responsavel: nomePublico(r.responsavel),
  };
}

/** "Pedro (31 99999-9999)" -> "Pedro". Remove telefones, e-mails e parênteses. */
function nomePublico(texto) {
  return String(texto || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\S+@\S+/g, ' ')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, ' ')
    .replace(/\b(tel|telefone|fone|whats(app)?|zap|cel|celular|contato)\b\s*[:.]?/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:\-–/|]+|[\s,;:\-–/|]+$/g, '')
    .trim();
}

/** Reconhece quais espaços oficiais são citados em um texto livre. */
function identificarEspacos(texto) {
  const n = normalizar(texto);
  if (CHAVES_TODOS_OS_ESPACOS.some((c) => n.indexOf(c) !== -1)) {
    return ESPACOS.map((e) => e.nome);
  }
  return ESPACOS
    .filter((e) => e.chaves.some((c) => n.indexOf(c) !== -1))
    .map((e) => e.nome);
}

/**
 * Interpreta intervalos digitados livremente:
 *   "14h - 19h", "9h às 13h", "14h30-16h", "14:00 - 19:00", "8h-12h", "dia todo".
 * Retorna { inicio, fim } em minutos ou null.
 */
function interpretarIntervalo(texto) {
  let t = normalizar(texto);
  if (!t) return null;
  if (/dia (todo|inteiro)|integral/.test(t)) return { inicio: 0, fim: 24 * 60 };

  t = t.replace(/(\d{1,2}:\d{2}):\d{2}/g, '$1');

  const horarios = [];
  const re = /(\d{1,2})\s*(?:(?:h|:)(\d{2})?)?/g;
  let m;
  while ((m = re.exec(t)) && horarios.length < 2) {
    const h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    if (h > 24 || min > 59) return null;
    horarios.push(h * 60 + min);
  }
  if (horarios.length < 2) return null;

  const inicio = horarios[0];
  const fim = horarios[1] === 0 ? 24 * 60 : horarios[1];
  return fim > inicio ? { inicio, fim } : null;
}

function intervalosSeSobrepoem(inicioA, fimA, inicioB, fimB) {
  return inicioA < fimB && inicioB < fimA;
}

// ---------------------------------------------------------------------------
//  GRAVAÇÃO
// ---------------------------------------------------------------------------

function linhaEstaVazia(l) {
  return !l.atividade && !l.tempo && !l.espaco && !l.responsavel && !l.observacoes;
}

/**
 * Escolhe onde gravar, sem nunca sobrescrever dados:
 *  1. Linha vazia na faixa de HORÁRIO que contém o início da reserva;
 *  2. Se a faixa existe mas está cheia, insere uma linha dentro dela;
 *  3. Senão, primeira linha vazia do dia;
 *  4. Senão, insere uma linha dentro do bloco do dia.
 */
function escolherLinhaParaGravacao(aba, linhasDoDia, r) {
  const naFaixa = linhasDoDia.filter((l) => {
    const f = interpretarIntervalo(l.faixa);
    return f && r.inicioMin >= f.inicio && r.inicioMin < f.fim;
  });

  const vaziaNaFaixa = naFaixa.find(linhaEstaVazia);
  if (vaziaNaFaixa) return vaziaNaFaixa.linha;
  if (naFaixa.length) return inserirLinhaNoGrupo(aba, naFaixa);

  const vazia = linhasDoDia.find(linhaEstaVazia);
  if (vazia) return vazia.linha;
  return inserirLinhaNoGrupo(aba, linhasDoDia);
}

/**
 * Insere uma linha no fim de um grupo de linhas (faixa ou dia).
 * Quando o grupo tem mais de uma linha, a nova linha entra ANTES da última,
 * ficando dentro de eventuais células mescladas (DATA, DIA DA SEMANA,
 * HORÁRIO) e herdando a formatação da linha de cima.
 */
function inserirLinhaNoGrupo(aba, grupo) {
  const primeira = grupo[0].linha;
  const ultima = grupo[grupo.length - 1].linha;
  if (ultima > primeira) {
    aba.insertRowAfter(ultima - 1);
    return ultima;
  }
  aba.insertRowAfter(ultima);
  return ultima + 1;
}

function gravarReserva(aba, colunas, linha, r) {
  const celula = (indice) => aba.getRange(linha, indice + 1);

  celula(colunas.atividade).setValue(textoSeguro(r.atividade));
  celula(colunas.tempo).setNumberFormat('@').setValue(formatarTempo(r.horaInicio, r.horaFim));
  celula(colunas.espaco).setValue(r.espaco);
  celula(colunas.responsavel).setValue(textoSeguro(`${r.responsavelNome} (${formatarTelefone(r.responsavelContato)})`));
  celula(colunas.observacoes).setValue(textoSeguro(r.observacoes));

  if (CONFIG.REGISTRAR_NOTA) {
    const quando = Utilities.formatDate(new Date(), fuso(), "dd/MM/yyyy 'às' HH:mm");
    celula(colunas.atividade).setNote(`Reserva feita pelo sistema online em ${quando}.`);
  }
}

function formatarTempo(inicio, fim) {
  if (CONFIG.FORMATO_TEMPO !== 'h') return `${inicio} - ${fim}`;
  const curto = (hhmm) => {
    const [h, m] = hhmm.split(':');
    return `${parseInt(h, 10)}h${m === '00' ? '' : m}`;
  };
  return `${curto(inicio)} - ${curto(fim)}`;
}

/** "(31) 99999-1234" / "5531999991234" -> "31 99999-1234" / "+55 31 99999-1234". */
function formatarTelefone(contato) {
  const d = String(contato || '').replace(/\D/g, '');
  const local = (n) => `${n.slice(0, 2)} ${n.slice(2, -4)}-${n.slice(-4)}`;
  if (d.length === 10 || d.length === 11) return local(d);
  if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) return `+55 ${local(d.slice(2))}`;
  return String(contato || '').trim();
}

/** Remove caracteres de controle e impede injeção de fórmulas (=, +, -, @). */
function textoSeguro(valor) {
  let s = String(valor == null ? '' : valor)
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .trim();
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return s;
}

// ---------------------------------------------------------------------------
//  VALIDAÇÃO DO PEDIDO
// ---------------------------------------------------------------------------

function validarReserva(p) {
  const texto = (v) => (v === undefined || v === null ? '' : String(v).trim());
  const erro = (message) => ({ ok: false, message });

  const dados = {
    data: texto(p.data),
    espaco: texto(p.espaco),
    horaInicio: texto(p.horaInicio),
    horaFim: texto(p.horaFim),
    atividade: texto(p.atividade),
    responsavelNome: texto(p.responsavelNome),
    responsavelContato: texto(p.responsavelContato),
    observacoes: texto(p.observacoes),
  };

  const d = interpretarDataISO(dados.data);
  if (!d) return erro('Data inválida.');

  const espaco = ESPACOS.find((x) => normalizar(x.nome) === normalizar(dados.espaco));
  if (!espaco) return erro('Espaço inválido.');

  const inicioMin = horaParaMinutos(dados.horaInicio);
  const fimMin = horaParaMinutos(dados.horaFim);
  if (inicioMin === null || fimMin === null) return erro('Horário inválido. Use o formato HH:mm.');
  if (fimMin <= inicioMin) return erro('A hora de término deve ser posterior à hora de início.');
  if (inicioMin < horaParaMinutos(CONFIG.HORA_MIN) || fimMin > horaParaMinutos(CONFIG.HORA_MAX)) {
    return erro(`As reservas devem acontecer entre ${CONFIG.HORA_MIN} e ${CONFIG.HORA_MAX}.`);
  }

  if (!dados.atividade) return erro('Descreva a atividade.');
  if (!dados.responsavelNome) return erro('Informe o nome da pessoa responsável.');
  const digitos = dados.responsavelContato.replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 13) return erro('Informe um telefone válido com DDD.');

  const L = CONFIG.LIMITES;
  if (dados.atividade.length > L.atividade) return erro(`A descrição da atividade deve ter até ${L.atividade} caracteres.`);
  if (dados.responsavelNome.length > L.responsavelNome) return erro('Nome do responsável muito longo.');
  if (dados.responsavelContato.length > L.responsavelContato) return erro('Contato muito longo.');
  if (dados.observacoes.length > L.observacoes) return erro(`As observações devem ter até ${L.observacoes} caracteres.`);

  const hoje = hojeNoFuso();
  if (!CONFIG.PERMITIR_DATAS_PASSADAS) {
    if (d.iso < hoje.iso) return erro('Não é possível reservar datas passadas.');
    if (d.iso === hoje.iso && inicioMin < hoje.minutos) return erro('Este horário de hoje já passou.');
  }
  const diasAteReserva = (Date.UTC(d.ano, d.mes - 1, d.dia) - Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia)) / 86400000;
  if (diasAteReserva > CONFIG.ANTECEDENCIA_MAXIMA_DIAS) {
    return erro(`Reservas podem ser feitas com até ${CONFIG.ANTECEDENCIA_MAXIMA_DIAS} dias de antecedência.`);
  }

  return {
    ok: true,
    reserva: Object.assign({}, dados, {
      data: d.iso,
      espaco: espaco.nome,
      ano: d.ano,
      mes: d.mes,
      dia: d.dia,
      inicioMin,
      fimMin,
    }),
  };
}

// ---------------------------------------------------------------------------
//  UTILITÁRIOS
// ---------------------------------------------------------------------------

function respostaJson(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Minúsculas, sem acentos e com espaços simples. */
function normalizar(valor) {
  return String(valor == null ? '' : valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** "2026-11-13" -> { ano, mes, dia, iso, diaSemana (0 = domingo) } ou null. */
function interpretarDataISO(texto) {
  const m = String(texto || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const ano = parseInt(m[1], 10);
  const mes = parseInt(m[2], 10);
  const dia = parseInt(m[3], 10);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
  return { ano, mes, dia, iso: dataISO(ano, mes, dia), diaSemana: data.getUTCDay() };
}

/** Aceita número (1-12) ou nome do mês ("novembro", "Março"). */
function interpretarMes(valor) {
  const n = parseInt(valor, 10);
  if (n >= 1 && n <= 12) return n;
  const indice = MESES.map(normalizar).indexOf(normalizar(valor));
  return indice >= 0 ? indice + 1 : null;
}

function dataISO(ano, mes, dia) {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function horaParaMinutos(hhmm) {
  const m = String(hhmm || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function minutosParaHora(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fuso() {
  return Session.getScriptTimeZone() || 'America/Sao_Paulo';
}

function hojeNoFuso() {
  const agora = new Date();
  const iso = Utilities.formatDate(agora, fuso(), 'yyyy-MM-dd');
  const [h, min] = Utilities.formatDate(agora, fuso(), 'HH:mm').split(':').map(Number);
  const [ano, mes, dia] = iso.split('-').map(Number);
  return { iso, ano, mes, dia, minutos: h * 60 + min };
}

// ---------------------------------------------------------------------------
//  TESTES MANUAIS (rodar pelo editor: selecione a função e clique em Executar)
// ---------------------------------------------------------------------------

/** Mostra no log as reservas do mês atual, como o site as recebe. */
function testarLeitura() {
  const hoje = hojeNoFuso();
  const resposta = doGet({ parameter: { mes: String(hoje.mes), ano: String(hoje.ano) } });
  console.log(resposta.getContent());
}

/** Mostra como a planilha foi interpretada (útil para conferir a estrutura). */
function testarEstrutura() {
  const hoje = hojeNoFuso();
  const agenda = localizarAgendaDoMes(hoje.mes, hoje.ano);
  if (!agenda) {
    console.log(`Aba de ${nomeDaAbaDoMes(hoje.mes)} não encontrada (ou dias da semana não batem com ${hoje.ano}).`);
    return;
  }
  console.log(`Aba: ${agenda.aba.getName()} | Cabeçalho na linha ${agenda.estrutura.linhaCabecalho}`);
  console.log('Colunas (0 = A):', JSON.stringify(agenda.estrutura.colunas));
  agenda.estrutura.linhas.slice(0, 30).forEach((l) => console.log(JSON.stringify(l)));
}

/** ATENÇÃO: grava uma reserva de teste de verdade (apague depois na planilha). */
function testarReserva() {
  const amanha = Utilities.formatDate(new Date(Date.now() + 86400000), fuso(), 'yyyy-MM-dd');
  const resposta = doPost({
    postData: {
      contents: JSON.stringify({
        data: amanha,
        espaco: 'Garagem',
        horaInicio: '20:00',
        horaFim: '21:00',
        atividade: 'TESTE DO SISTEMA (Interna)',
        responsavelNome: 'Teste',
        responsavelContato: '(31) 99999-9999',
        observacoes: 'Pode apagar esta linha.',
      }),
    },
  });
  console.log(resposta.getContent());
}
