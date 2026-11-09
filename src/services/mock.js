// Backend fictício usado apenas quando VITE_API_URL não está definida.
// Imita as respostas do Code.gs e guarda os dados no localStorage.
import { adicionarDias, hojeISO, horaCurta, paraMinutos, seSobrepoem } from '../utils/tempo'

const CHAVE = 'casa-tina-agenda-demonstracao-v1'
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

function dadosIniciais() {
  const hoje = hojeISO()
  const amanha = adicionarDias(hoje, 1)
  return [
    { data: hoje, espaco: 'Sala de Atendimento', horaInicio: '08:00', horaFim: '12:00', atividade: 'Acolhimento e atendimento (Interna)', responsavel: 'Equipe da Casa' },
    { data: hoje, espaco: 'Galpão', horaInicio: '09:00', horaFim: '13:00', atividade: 'Oficina de serigrafia (Externa)', responsavel: 'Ana' },
    { data: hoje, espaco: 'Cozinha', horaInicio: '12:00', horaFim: '14:00', atividade: 'Almoço coletivo (Interna)', responsavel: 'Coletivo da Cozinha' },
    { data: hoje, espaco: 'Sala Valdete Guerra', horaInicio: '14:00', horaFim: '19:00', atividade: 'Sarau Novembro Negro (Interna)', responsavel: 'Pedro' },
    { data: hoje, espaco: 'Sala Eliana Silva', horaInicio: '18:30', horaFim: '21:00', atividade: 'Roda de conversa: mulheres e território (Externa)', responsavel: 'Juliana' },
    { data: amanha, espaco: 'Garagem', horaInicio: '10:00', horaFim: '12:00', atividade: 'Bazar solidário (Interna)', responsavel: 'Marta' },
  ]
}

function ler() {
  try {
    const salvo = localStorage.getItem(CHAVE)
    if (salvo) return JSON.parse(salvo)
  } catch {
    /* dados corrompidos: recomeça */
  }
  const dados = dadosIniciais()
  salvar(dados)
  return dados
}

function salvar(dados) {
  localStorage.setItem(CHAVE, JSON.stringify(dados))
}

export async function listar(ano, mes) {
  await esperar(450)
  const prefixo = `${ano}-${String(mes).padStart(2, '0')}`
  return {
    success: true,
    reservas: ler()
      .filter((r) => r.data.startsWith(prefixo))
      .map((r) => ({ ...r, horario: `${horaCurta(r.horaInicio)} - ${horaCurta(r.horaFim)}` })),
  }
}

export async function criar(p) {
  await esperar(900)
  const reservas = ler()
  const conflito = reservas.find(
    (r) =>
      r.data === p.data &&
      r.espaco === p.espaco &&
      seSobrepoem(paraMinutos(p.horaInicio), paraMinutos(p.horaFim), paraMinutos(r.horaInicio), paraMinutos(r.horaFim)),
  )
  if (conflito) {
    return {
      success: false,
      code: 'CONFLITO',
      message: 'O espaço selecionado já possui reserva neste horário.',
      conflito: { horaInicio: conflito.horaInicio, horaFim: conflito.horaFim, atividade: conflito.atividade },
    }
  }
  reservas.push({
    data: p.data,
    espaco: p.espaco,
    horaInicio: p.horaInicio,
    horaFim: p.horaFim,
    atividade: p.atividade,
    responsavel: p.responsavelNome,
  })
  salvar(reservas)
  return { success: true, message: 'Reserva realizada com sucesso!' }
}
