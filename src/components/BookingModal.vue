<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import Icone from './Icone.vue'
import { HORA_ABERTURA, HORA_FECHAMENTO, INTERVALO_MINUTOS } from '../constants/agenda'
import { criarReserva } from '../services/api'
import {
  formatarDataCurta,
  formatarDuracao,
  formatarTelefone,
  gerarHorarios,
  hojeISO,
  minutosAgora,
  paraHora,
  paraMinutos,
  seSobrepoem,
} from '../utils/tempo'

const props = defineProps({
  aberto: Boolean,
  espacos: { type: Array, required: true },
  inicial: { type: Object, default: () => ({}) },
  reservasConhecidas: { type: Array, default: () => [] },
})

const emit = defineEmits(['fechar', 'reservado', 'conflito'])

const CHAVE_CONTATO = 'casa-tina-ultimo-responsavel'
const LIMITE_DESCRICAO = 250
const LIMITE_OBSERVACOES = 500
const HORARIOS = gerarHorarios(HORA_ABERTURA, HORA_FECHAMENTO, INTERVALO_MINUTOS)

const formularioVazio = () => ({
  espaco: '',
  data: hojeISO(),
  horaInicio: '',
  horaFim: '',
  tipoAtividade: '',
  descricao: '',
  responsavelNome: '',
  responsavelContato: '',
  observacoes: '',
  website: '',
})

const form = reactive(formularioVazio())
const erros = reactive({})
const enviando = ref(false)
const alerta = ref(null)
const reservaConfirmada = ref(null)
const primeiroCampo = ref(null)

const hoje = computed(() => hojeISO())

const opcoesInicio = computed(() => {
  const minimo = form.data === hoje.value ? minutosAgora() : -1
  return HORARIOS.slice(0, -1).filter((h) => paraMinutos(h) >= minimo || h === form.horaInicio)
})

const opcoesFim = computed(() => {
  const inicio = paraMinutos(form.horaInicio)
  return HORARIOS.filter((h) => inicio === null || paraMinutos(h) > inicio)
})

const duracao = computed(() => {
  const ini = paraMinutos(form.horaInicio)
  const fim = paraMinutos(form.horaFim)
  return ini !== null && fim !== null && fim > ini ? formatarDuracao(fim - ini) : ''
})

/** Aviso antecipado com base na agenda já carregada (o backend é quem decide). */
const conflitoPrevisto = computed(() => {
  const ini = paraMinutos(form.horaInicio)
  const fim = paraMinutos(form.horaFim)
  if (!form.espaco || !form.data || ini === null || fim === null || fim <= ini) return null
  return (
    props.reservasConhecidas.find(
      (r) =>
        r.data === form.data &&
        r.espaco === form.espaco &&
        seSobrepoem(ini, fim, paraMinutos(r.horaInicio), paraMinutos(r.horaFim)),
    ) || null
  )
})

watch(
  () => form.horaInicio,
  (inicio) => {
    if (!inicio) return
    const ini = paraMinutos(inicio)
    if (paraMinutos(form.horaFim) > ini) return
    const sugestao = paraHora(Math.min(ini + 60, paraMinutos(HORA_FECHAMENTO)))
    form.horaFim = sugestao
  },
)

watch(
  () => props.aberto,
  (aberto) => {
    document.body.style.overflow = aberto ? 'hidden' : ''
    if (aberto) {
      window.addEventListener('keydown', aoPressionarTecla)
      iniciarFormulario()
    } else {
      window.removeEventListener('keydown', aoPressionarTecla)
    }
  },
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', aoPressionarTecla)
})

function contatoSalvo() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_CONTATO)) || {}
  } catch {
    return {}
  }
}

function iniciarFormulario({ manterContato = false } = {}) {
  const contatoAnterior = manterContato
    ? { responsavelNome: form.responsavelNome, responsavelContato: form.responsavelContato }
    : contatoSalvo()

  const inicial = Object.fromEntries(Object.entries(props.inicial || {}).filter(([, v]) => v))
  if (inicial.data && inicial.data < hoje.value) delete inicial.data

  Object.assign(form, formularioVazio(), contatoAnterior, inicial)
  Object.keys(erros).forEach((k) => delete erros[k])
  alerta.value = null
  reservaConfirmada.value = null
  nextTick(() => primeiroCampo.value?.focus())
}

function aoPressionarTecla(evento) {
  if (evento.key === 'Escape') fechar()
}

function fechar() {
  if (!enviando.value) emit('fechar')
}

function aoDigitarTelefone(evento) {
  form.responsavelContato = formatarTelefone(evento.target.value)
}

function validar() {
  Object.keys(erros).forEach((k) => delete erros[k])

  if (!form.espaco) erros.espaco = 'Escolha o espaço.'
  if (!form.data) erros.data = 'Informe a data.'
  else if (form.data < hoje.value) erros.data = 'Escolha uma data a partir de hoje.'

  if (!form.horaInicio) erros.horaInicio = 'Informe o início.'
  if (!form.horaFim) erros.horaFim = 'Informe o término.'
  if (form.horaInicio && form.horaFim && paraMinutos(form.horaFim) <= paraMinutos(form.horaInicio)) {
    erros.horaFim = 'O término deve ser depois do início.'
  }
  if (form.data === hoje.value && form.horaInicio && paraMinutos(form.horaInicio) < minutosAgora()) {
    erros.horaInicio = 'Esse horário de hoje já passou.'
  }

  if (!form.tipoAtividade) erros.tipoAtividade = 'Informe se a atividade é interna ou externa.'
  if (!form.descricao.trim()) erros.descricao = 'Descreva a atividade.'
  if (!form.responsavelNome.trim()) erros.responsavelNome = 'Informe o nome da pessoa responsável.'

  const digitos = form.responsavelContato.replace(/\D/g, '')
  if (!digitos) erros.responsavelContato = 'Informe um telefone ou WhatsApp.'
  else if (digitos.length < 10) erros.responsavelContato = 'Inclua o DDD e o número completo.'

  return Object.keys(erros).length === 0
}

async function enviar() {
  alerta.value = null
  if (!validar()) {
    nextTick(() => document.querySelector('[aria-invalid="true"]')?.focus())
    return
  }

  const payload = {
    data: form.data,
    espaco: form.espaco,
    horaInicio: form.horaInicio,
    horaFim: form.horaFim,
    atividade: `${form.descricao.trim()} (${form.tipoAtividade})`,
    responsavelNome: form.responsavelNome.trim(),
    responsavelContato: form.responsavelContato.trim(),
    observacoes: form.observacoes.trim(),
    website: form.website,
  }

  enviando.value = true
  try {
    const resposta = await criarReserva(payload)

    if (resposta.success) {
      localStorage.setItem(
        CHAVE_CONTATO,
        JSON.stringify({ responsavelNome: payload.responsavelNome, responsavelContato: payload.responsavelContato }),
      )
      reservaConfirmada.value = payload
      emit('reservado', payload)
    } else if (resposta.code === 'CONFLITO') {
      const c = resposta.conflito
      alerta.value = {
        tipo: 'conflito',
        titulo: 'Horário indisponível',
        mensagem: resposta.message,
        detalhe: c ? `Já reservado das ${c.horaInicio} às ${c.horaFim}${c.atividade ? ` — ${c.atividade}` : ''}.` : '',
      }
      emit('conflito', payload)
    } else {
      alerta.value = { tipo: 'erro', titulo: 'Não foi possível reservar', mensagem: resposta.message }
    }
  } catch (erro) {
    alerta.value = { tipo: 'erro', titulo: 'Falha na conexão', mensagem: erro.message }
  } finally {
    enviando.value = false
  }
}

function novaReserva() {
  iniciarFormulario({ manterContato: true })
}

const classeCampo = (campo) => ['campo', erros[campo] && 'campo-invalido']
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="aberto"
        class="fixed inset-0 z-50 flex items-end justify-center bg-tina-950/50 backdrop-blur-sm sm:items-center sm:p-4"
        @mousedown.self="fechar"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-reserva"
          class="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-3xl"
        >
          <header class="flex items-start justify-between gap-4 border-b border-stone-100 px-5 py-4 sm:px-6">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-terra-600">Casa Tina Martins</p>
              <h2 id="titulo-reserva" class="font-display text-xl font-semibold text-tina-950">
                {{ reservaConfirmada ? 'Reserva confirmada' : 'Reservar espaço' }}
              </h2>
            </div>
            <button type="button" class="btn-icone h-9 w-9" aria-label="Fechar" :disabled="enviando" @click="fechar">
              <Icone nome="fechar" class="h-5 w-5" />
            </button>
          </header>

          <!-- Sucesso -->
          <div v-if="reservaConfirmada" class="overflow-y-auto px-6 py-8 text-center">
            <span class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/50">
              <Icone nome="sucesso" class="h-9 w-9" />
            </span>
            <p class="mt-4 font-display text-2xl font-semibold text-tina-950">Reserva realizada com sucesso!</p>
            <p class="mt-1 text-sm text-stone-600">Seu horário já aparece na agenda da Casa.</p>

            <dl class="mx-auto mt-6 max-w-sm divide-y divide-stone-100 rounded-2xl border border-stone-200 text-left text-sm">
              <div class="flex justify-between gap-4 px-4 py-3">
                <dt class="text-stone-500">Espaço</dt>
                <dd class="text-right font-semibold text-stone-900">{{ reservaConfirmada.espaco }}</dd>
              </div>
              <div class="flex justify-between gap-4 px-4 py-3">
                <dt class="text-stone-500">Data</dt>
                <dd class="text-right font-semibold capitalize text-stone-900">{{ formatarDataCurta(reservaConfirmada.data) }}</dd>
              </div>
              <div class="flex justify-between gap-4 px-4 py-3">
                <dt class="text-stone-500">Horário</dt>
                <dd class="text-right font-semibold text-stone-900">
                  {{ reservaConfirmada.horaInicio }} – {{ reservaConfirmada.horaFim }}
                </dd>
              </div>
              <div class="flex justify-between gap-4 px-4 py-3">
                <dt class="text-stone-500">Atividade</dt>
                <dd class="text-right font-semibold text-stone-900">{{ reservaConfirmada.atividade }}</dd>
              </div>
            </dl>

            <p class="mx-auto mt-5 max-w-sm text-xs text-stone-500">
              Precisa cancelar ou alterar? Fale com a administração da Casa — reservas feitas pelo site só podem ser
              modificadas por ela.
            </p>

            <div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
              <button type="button" class="btn-secundario" @click="novaReserva">Fazer outra reserva</button>
              <button type="button" class="btn-primario" @click="emit('fechar')">Concluir</button>
            </div>
          </div>

          <!-- Formulário -->
          <form v-else class="flex min-h-0 flex-1 flex-col" novalidate @submit.prevent="enviar">
            <div class="space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
              <div
                v-if="alerta"
                role="alert"
                class="flex gap-3 rounded-2xl border px-4 py-3 text-sm"
                :class="alerta.tipo === 'conflito' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-terra-200 bg-terra-50 text-terra-900'"
              >
                <Icone nome="alerta" class="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p class="font-semibold">{{ alerta.titulo }}</p>
                  <p>{{ alerta.mensagem }}</p>
                  <p v-if="alerta.detalhe" class="mt-1 opacity-80">{{ alerta.detalhe }}</p>
                  <p v-if="alerta.tipo === 'conflito'" class="mt-1 opacity-80">Escolha outro horário ou outro espaço.</p>
                </div>
              </div>

              <div>
                <label for="campo-espaco" class="rotulo">Espaço</label>
                <select
                  id="campo-espaco"
                  ref="primeiroCampo"
                  v-model="form.espaco"
                  :class="classeCampo('espaco')"
                  :aria-invalid="!!erros.espaco"
                >
                  <option value="" disabled>Selecione um espaço</option>
                  <option v-for="e in espacos" :key="e.nome" :value="e.nome">{{ e.nome }}</option>
                </select>
                <p v-if="erros.espaco" class="erro-campo">{{ erros.espaco }}</p>
              </div>

              <div class="grid gap-4 sm:grid-cols-3">
                <div class="sm:col-span-1">
                  <label for="campo-data" class="rotulo">Data</label>
                  <input
                    id="campo-data"
                    v-model="form.data"
                    type="date"
                    :min="hoje"
                    :class="classeCampo('data')"
                    :aria-invalid="!!erros.data"
                  />
                  <p v-if="erros.data" class="erro-campo">{{ erros.data }}</p>
                </div>
                <div>
                  <label for="campo-inicio" class="rotulo">Início</label>
                  <select
                    id="campo-inicio"
                    v-model="form.horaInicio"
                    :class="classeCampo('horaInicio')"
                    :aria-invalid="!!erros.horaInicio"
                  >
                    <option value="" disabled>--:--</option>
                    <option v-for="h in opcoesInicio" :key="h" :value="h">{{ h }}</option>
                  </select>
                  <p v-if="erros.horaInicio" class="erro-campo">{{ erros.horaInicio }}</p>
                </div>
                <div>
                  <label for="campo-fim" class="rotulo">Término</label>
                  <select
                    id="campo-fim"
                    v-model="form.horaFim"
                    :class="classeCampo('horaFim')"
                    :aria-invalid="!!erros.horaFim"
                  >
                    <option value="" disabled>--:--</option>
                    <option v-for="h in opcoesFim" :key="h" :value="h">{{ h }}</option>
                  </select>
                  <p v-if="erros.horaFim" class="erro-campo">{{ erros.horaFim }}</p>
                </div>
              </div>

              <p v-if="duracao && !conflitoPrevisto" class="-mt-2 flex items-center gap-1.5 text-xs text-stone-500">
                <Icone nome="relogio" class="h-3.5 w-3.5" /> Duração: {{ duracao }}
              </p>
              <p
                v-if="conflitoPrevisto"
                class="-mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                <Icone nome="alerta" class="mt-px h-3.5 w-3.5 shrink-0" />
                Pela agenda, este espaço já está reservado das {{ conflitoPrevisto.horaInicio }} às
                {{ conflitoPrevisto.horaFim }} ({{ conflitoPrevisto.atividade || 'reservado' }}).
              </p>

              <fieldset>
                <legend class="rotulo">A atividade é</legend>
                <div class="grid grid-cols-2 gap-3">
                  <label
                    v-for="tipo in ['Interna', 'Externa']"
                    :key="tipo"
                    class="flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition"
                    :class="form.tipoAtividade === tipo
                      ? 'border-tina-500 bg-tina-50 text-tina-900 ring-4 ring-tina-100'
                      : erros.tipoAtividade ? 'border-terra-400 bg-white' : 'border-stone-200 bg-white hover:border-tina-200'"
                  >
                    <input
                      v-model="form.tipoAtividade"
                      type="radio"
                      name="tipo-atividade"
                      :value="tipo"
                      class="h-4 w-4 accent-tina-700"
                      :aria-invalid="!!erros.tipoAtividade"
                    />
                    <span>
                      <span class="block font-semibold">{{ tipo }}</span>
                      <span class="text-xs text-stone-500">
                        {{ tipo === 'Interna' ? 'Organizada pela Casa' : 'Grupo ou pessoa de fora' }}
                      </span>
                    </span>
                  </label>
                </div>
                <p v-if="erros.tipoAtividade" class="erro-campo">{{ erros.tipoAtividade }}</p>
              </fieldset>

              <div>
                <label for="campo-descricao" class="rotulo">Descrição da atividade</label>
                <textarea
                  id="campo-descricao"
                  v-model="form.descricao"
                  rows="2"
                  :maxlength="LIMITE_DESCRICAO"
                  placeholder="Ex.: Sarau Novembro Negro, oficina de costura, reunião do coletivo…"
                  :class="classeCampo('descricao')"
                  :aria-invalid="!!erros.descricao"
                ></textarea>
                <p v-if="erros.descricao" class="erro-campo">{{ erros.descricao }}</p>
              </div>

              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label for="campo-nome" class="rotulo">Nome da pessoa responsável</label>
                  <input
                    id="campo-nome"
                    v-model="form.responsavelNome"
                    type="text"
                    autocomplete="name"
                    maxlength="120"
                    placeholder="Nome completo"
                    :class="classeCampo('responsavelNome')"
                    :aria-invalid="!!erros.responsavelNome"
                  />
                  <p v-if="erros.responsavelNome" class="erro-campo">{{ erros.responsavelNome }}</p>
                </div>
                <div>
                  <label for="campo-telefone" class="rotulo">Telefone / WhatsApp</label>
                  <input
                    id="campo-telefone"
                    :value="form.responsavelContato"
                    type="tel"
                    inputmode="tel"
                    autocomplete="tel-national"
                    placeholder="(31) 99999-9999"
                    :class="classeCampo('responsavelContato')"
                    :aria-invalid="!!erros.responsavelContato"
                    @input="aoDigitarTelefone"
                  />
                  <p v-if="erros.responsavelContato" class="erro-campo">{{ erros.responsavelContato }}</p>
                </div>
              </div>

              <div>
                <label for="campo-obs" class="rotulo">
                  Observações <span class="font-normal text-stone-400">(opcional)</span>
                </label>
                <textarea
                  id="campo-obs"
                  v-model="form.observacoes"
                  rows="2"
                  :maxlength="LIMITE_OBSERVACOES"
                  placeholder="Número de pessoas, equipamentos necessários, acessibilidade…"
                  class="campo"
                ></textarea>
              </div>

              <!-- Armadilha anti-robô: invisível para pessoas -->
              <div class="absolute -left-[9999px]" aria-hidden="true">
                <label for="campo-website">Não preencha</label>
                <input id="campo-website" v-model="form.website" type="text" tabindex="-1" autocomplete="off" />
              </div>

              <p class="text-xs text-stone-500">
                Seu telefone fica visível apenas para a administração da Casa e não aparece na agenda pública.
              </p>
            </div>

            <footer class="flex gap-3 border-t border-stone-100 bg-stone-50/80 px-5 py-4 sm:px-6">
              <button type="button" class="btn-secundario" :disabled="enviando" @click="fechar">Cancelar</button>
              <button type="submit" class="btn-primario flex-1" :disabled="enviando">
                <Icone v-if="enviando" nome="atualizar" class="h-4 w-4 animate-spin" />
                {{ enviando ? 'Enviando reserva…' : 'Confirmar reserva' }}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
