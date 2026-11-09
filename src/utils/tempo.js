const pad = (n) => String(n).padStart(2, '0')

export function paraMinutos(hhmm) {
  if (!hhmm) return null
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + (m || 0)
}

export function paraHora(minutos) {
  return `${pad(Math.floor(minutos / 60))}:${pad(minutos % 60)}`
}

/** "14:00" -> "14h", "14:30" -> "14h30" */
export function horaCurta(hhmm) {
  const [h, m] = String(hhmm).split(':')
  return `${Number(h)}h${m && m !== '00' ? m : ''}`
}

export function formatarDuracao(minutos) {
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  if (!h) return `${m} min`
  return m ? `${h}h${pad(m)}` : `${h}h`
}

export function gerarHorarios(inicio, fim, passo) {
  const lista = []
  for (let m = paraMinutos(inicio); m <= paraMinutos(fim); m += passo) lista.push(paraHora(m))
  return lista
}

export function arredondarParaCima(minutos, passo) {
  return Math.ceil(minutos / passo) * passo
}

export function minutosAgora() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

/** Intervalos livres entre `inicio` e `fim`, dados os ocupados ({ ini, fim }). */
export function intervalosLivres(ocupados, inicio, fim) {
  const livres = []
  let cursor = inicio
  for (const o of [...ocupados].sort((a, b) => a.ini - b.ini)) {
    if (cursor >= fim) break
    if (o.ini > cursor) livres.push({ ini: cursor, fim: Math.min(o.ini, fim) })
    cursor = Math.max(cursor, o.fim)
  }
  if (cursor < fim) livres.push({ ini: cursor, fim })
  return livres.filter((l) => l.fim > l.ini)
}

export function seSobrepoem(iniA, fimA, iniB, fimB) {
  return iniA < fimB && iniB < fimA
}

// ---- Datas (sempre no fuso local, no formato AAAA-MM-DD) -------------------

export function paraISO(data) {
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}`
}

export function hojeISO() {
  return paraISO(new Date())
}

export function partesDaData(iso) {
  const [ano, mes, dia] = iso.split('-').map(Number)
  return { ano, mes, dia }
}

function paraDate(iso) {
  const { ano, mes, dia } = partesDaData(iso)
  return new Date(ano, mes - 1, dia)
}

export function adicionarDias(iso, dias) {
  const d = paraDate(iso)
  d.setDate(d.getDate() + dias)
  return paraISO(d)
}

/** "13 de novembro de 2026" */
export function formatarDataLonga(iso) {
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(paraDate(iso))
}

/** "sexta-feira" */
export function diaDaSemana(iso) {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(paraDate(iso))
}

/** "sex., 13/11/2026" */
export function formatarDataCurta(iso) {
  const semana = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(paraDate(iso))
  return `${semana} ${new Intl.DateTimeFormat('pt-BR').format(paraDate(iso))}`
}

// ---- Telefone ---------------------------------------------------------------

/** Máscara: (31) 99999-9999 / (31) 3333-3333 */
export function formatarTelefone(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}
