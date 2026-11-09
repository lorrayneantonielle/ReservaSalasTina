import * as demonstracao from './mock'

const API_URL = (import.meta.env.VITE_API_URL || '').trim()
const TEMPO_LIMITE_MS = 25_000
const CACHE_MS = 60_000

/** Sem VITE_API_URL o site usa dados fictícios salvos no navegador. */
export const modoDemonstracao = !API_URL

export class ApiError extends Error {}

const cache = new Map()
const chaveDoMes = (ano, mes) => `${ano}-${mes}`

/**
 * O Apps Script responde com um redirect 302 para googleusercontent.com,
 * por isso `redirect: 'follow'`. No POST usamos Content-Type text/plain:
 * é uma "requisição simples" de CORS e não dispara o preflight (OPTIONS),
 * que o Apps Script não suporta. O corpo continua sendo JSON.
 */
async function requisitar({ params, ...opcoes } = {}) {
  const url = new URL(API_URL)
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v))

  const controle = new AbortController()
  const temporizador = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS)

  try {
    const resposta = await fetch(url, { redirect: 'follow', signal: controle.signal, ...opcoes })
    if (!resposta.ok) throw new ApiError(`Falha na comunicação com a agenda (HTTP ${resposta.status}).`)

    const texto = await resposta.text()
    try {
      return JSON.parse(texto)
    } catch {
      throw new ApiError('A agenda respondeu em um formato inesperado. Verifique se o Web App está publicado com acesso "Qualquer pessoa".')
    }
  } catch (erro) {
    if (erro instanceof ApiError) throw erro
    if (erro.name === 'AbortError') {
      throw new ApiError('A agenda demorou demais para responder. Verifique sua conexão e confira a agenda antes de tentar de novo.')
    }
    throw new ApiError('Não foi possível conectar à agenda. Verifique sua conexão com a internet.')
  } finally {
    clearTimeout(temporizador)
  }
}

/**
 * Reservas de um mês.
 * Retorna { reservas, abaDisponivel, mensagem? }.
 * `abaDisponivel = false` quando a aba do mês ainda não existe na planilha.
 */
export async function listarReservasDoMes(ano, mes, { forcar = false } = {}) {
  const chave = chaveDoMes(ano, mes)
  const emCache = cache.get(chave)
  if (!forcar && emCache && Date.now() - emCache.em < CACHE_MS) return emCache.dados

  const resposta = modoDemonstracao
    ? await demonstracao.listar(ano, mes)
    : await requisitar({ params: { mes, ano }, cache: 'no-store' })

  let dados
  if (resposta.success) {
    dados = { reservas: resposta.reservas || [], abaDisponivel: true }
  } else if (resposta.code === 'ABA_NAO_ENCONTRADA') {
    dados = { reservas: [], abaDisponivel: false, mensagem: resposta.message }
  } else {
    throw new ApiError(resposta.message || 'Não foi possível carregar a agenda.')
  }

  cache.set(chave, { em: Date.now(), dados })
  return dados
}

/**
 * Cria uma reserva. Retorna a resposta da API:
 *   { success: true, message }
 *   { success: false, code: 'CONFLITO' | 'VALIDACAO' | ..., message, conflito? }
 */
export async function criarReserva(reserva) {
  try {
    return modoDemonstracao
      ? await demonstracao.criar(reserva)
      : await requisitar({
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(reserva),
        })
  } finally {
    const [ano, mes] = reserva.data.split('-').map(Number)
    cache.delete(chaveDoMes(ano, mes))
  }
}
