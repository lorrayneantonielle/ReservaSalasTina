<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import AgendaView from './components/AgendaView.vue'
import BookingModal from './components/BookingModal.vue'
import Icone from './components/Icone.vue'
import { ESPACOS } from './constants/agenda'
import { listarReservasDoMes, modoDemonstracao } from './services/api'
import { adicionarDias, hojeISO, partesDaData } from './utils/tempo'

const dataSelecionada = ref(hojeISO())
const filtroEspaco = ref('todos')

const reservasDoMes = ref([])
const abaDisponivel = ref(true)
const avisoAgenda = ref('')
const carregando = ref(false)
const erro = ref('')

const modalAberto = ref(false)
const dadosIniciais = ref({})

let mesCarregado = null
let ultimaRequisicao = 0

const ehHoje = computed(() => dataSelecionada.value === hojeISO())

const espacosVisiveis = computed(() =>
  filtroEspaco.value === 'todos' ? ESPACOS : ESPACOS.filter((e) => e.nome === filtroEspaco.value),
)

const reservasDoDia = computed(() => reservasDoMes.value.filter((r) => r.data === dataSelecionada.value))

async function carregarMes({ forcar = false } = {}) {
  const { ano, mes } = partesDaData(dataSelecionada.value)
  const chave = `${ano}-${mes}`
  if (!forcar && chave === mesCarregado) return

  const id = ++ultimaRequisicao
  carregando.value = true
  erro.value = ''
  try {
    const resultado = await listarReservasDoMes(ano, mes, { forcar })
    if (id !== ultimaRequisicao) return
    reservasDoMes.value = resultado.reservas
    abaDisponivel.value = resultado.abaDisponivel
    avisoAgenda.value = resultado.mensagem || ''
    mesCarregado = chave
  } catch (e) {
    if (id !== ultimaRequisicao) return
    erro.value = e.message
    reservasDoMes.value = []
    mesCarregado = null
  } finally {
    if (id === ultimaRequisicao) carregando.value = false
  }
}

watch(dataSelecionada, (data) => {
  if (!data) dataSelecionada.value = hojeISO()
  else carregarMes()
})

onMounted(() => carregarMes())

function mudarDia(dias) {
  dataSelecionada.value = adicionarDias(dataSelecionada.value, dias)
}

function abrirReserva(prefill = {}) {
  dadosIniciais.value = {
    data: dataSelecionada.value,
    espaco: filtroEspaco.value === 'todos' ? '' : filtroEspaco.value,
    ...prefill,
  }
  modalAberto.value = true
}

function atualizarAgenda(reserva) {
  mesCarregado = null
  if (dataSelecionada.value !== reserva.data) dataSelecionada.value = reserva.data
  else carregarMes({ forcar: true })
}
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="relative overflow-hidden bg-tina-900 text-white">
      <div class="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-terra-500/30 blur-2xl"></div>
      <div class="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-tina-500/30 blur-3xl"></div>

      <div class="relative mx-auto flex max-w-7xl items-center gap-4 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <span class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/20 sm:h-14 sm:w-14">
          <svg viewBox="0 0 64 64" class="h-8 w-8 sm:h-9 sm:w-9" aria-hidden="true">
            <path d="M10 30 32 12l22 18v20a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4Z" fill="#e07c58" />
            <path d="M25 54V38h14v16" fill="#fbf7f2" />
          </svg>
        </span>
        <div class="min-w-0">
          <h1 class="font-display text-2xl font-semibold leading-tight sm:text-3xl">Casa Tina Martins</h1>
          <p class="text-sm text-tina-100/90">Agenda e reserva de espaços</p>
        </div>
      </div>
    </header>

    <div class="sticky top-0 z-30 border-b border-stone-200/80 bg-creme/90 backdrop-blur">
      <div class="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <div class="flex items-center gap-2">
          <button type="button" class="btn-icone" aria-label="Dia anterior" @click="mudarDia(-1)">
            <Icone nome="seta-esquerda" class="h-5 w-5" />
          </button>
          <label for="filtro-data" class="sr-only">Data</label>
          <input id="filtro-data" v-model="dataSelecionada" type="date" class="campo min-w-0 flex-1 sm:w-44 sm:flex-none" />
          <button type="button" class="btn-icone" aria-label="Próximo dia" @click="mudarDia(1)">
            <Icone nome="seta-direita" class="h-5 w-5" />
          </button>
          <button type="button" class="btn-secundario" :disabled="ehHoje" @click="dataSelecionada = hojeISO()">Hoje</button>
        </div>

        <div class="flex items-center gap-2 sm:ml-auto">
          <label for="filtro-espaco" class="sr-only">Espaço</label>
          <select id="filtro-espaco" v-model="filtroEspaco" class="campo sm:w-60">
            <option value="todos">Todos os espaços</option>
            <option v-for="e in ESPACOS" :key="e.nome" :value="e.nome">{{ e.nome }}</option>
          </select>
          <button
            type="button"
            class="btn-icone"
            aria-label="Atualizar agenda"
            title="Atualizar agenda"
            :disabled="carregando"
            @click="carregarMes({ forcar: true })"
          >
            <Icone nome="atualizar" class="h-5 w-5" :class="{ 'animate-spin': carregando }" />
          </button>
        </div>
      </div>
    </div>

    <main class="mx-auto w-full max-w-7xl flex-1 px-4 pb-32 pt-6 sm:px-6 lg:px-8">
      <p
        v-if="modoDemonstracao"
        class="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <strong>Modo demonstração:</strong> nenhuma URL de API configurada (<code>VITE_API_URL</code>). As reservas são
        fictícias e ficam salvas apenas neste navegador.
      </p>

      <AgendaView
        :data="dataSelecionada"
        :espacos="espacosVisiveis"
        :reservas="reservasDoDia"
        :carregando="carregando"
        :erro="erro"
        :aba-disponivel="abaDisponivel"
        :aviso="avisoAgenda"
        @reservar="abrirReserva"
        @recarregar="carregarMes({ forcar: true })"
      />
    </main>

    <footer class="border-t border-stone-200/80 pb-24 pt-6 text-center text-xs text-stone-500 sm:pb-6">
      Para cancelar ou alterar uma reserva, entre em contato com a administração da Casa Tina Martins.
    </footer>

    <button
      type="button"
      class="btn-destaque fixed inset-x-4 bottom-4 z-40 py-3.5 text-base sm:inset-x-auto sm:bottom-6 sm:right-6 sm:px-6"
      style="margin-bottom: env(safe-area-inset-bottom)"
      @click="abrirReserva()"
    >
      <Icone nome="mais" class="h-5 w-5" /> Reservar Espaço
    </button>

    <BookingModal
      :aberto="modalAberto"
      :espacos="ESPACOS"
      :inicial="dadosIniciais"
      :reservas-conhecidas="reservasDoMes"
      @fechar="modalAberto = false"
      @reservado="atualizarAgenda"
      @conflito="atualizarAgenda"
    />
  </div>
</template>
