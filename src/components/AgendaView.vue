<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import Icone from './Icone.vue'
import { HORA_ABERTURA, HORA_FECHAMENTO, INTERVALO_MINUTOS } from '../constants/agenda'
import {
  arredondarParaCima,
  diaDaSemana,
  formatarDataLonga,
  formatarDuracao,
  hojeISO,
  intervalosLivres,
  minutosAgora,
  paraHora,
  paraMinutos,
} from '../utils/tempo'

const props = defineProps({
  data: { type: String, required: true },
  espacos: { type: Array, required: true },
  reservas: { type: Array, default: () => [] },
  carregando: Boolean,
  erro: { type: String, default: '' },
  abaDisponivel: { type: Boolean, default: true },
  aviso: { type: String, default: '' },
})

const emit = defineEmits(['reservar', 'recarregar'])

const INICIO = paraMinutos(HORA_ABERTURA)
const FIM = paraMinutos(HORA_FECHAMENTO)
const PX_POR_HORA = 56
const MARGEM = 12
const alturaGrade = ((FIM - INICIO) / 60) * PX_POR_HORA + MARGEM * 2
const horas = Array.from({ length: (FIM - INICIO) / 60 + 1 }, (_, i) => INICIO / 60 + i)

const agora = ref(minutosAgora())
const relogio = setInterval(() => (agora.value = minutosAgora()), 60_000)
onBeforeUnmount(() => clearInterval(relogio))

const ehHoje = computed(() => props.data === hojeISO())
const ehPassado = computed(() => props.data < hojeISO())
const dataLonga = computed(() => formatarDataLonga(props.data))
const semana = computed(() => diaDaSemana(props.data))
const totalReservas = computed(() => colunas.value.reduce((t, c) => t + c.ocupados.length, 0))

const y = (minutos) => MARGEM + ((Math.min(Math.max(minutos, INICIO), FIM) - INICIO) / 60) * PX_POR_HORA
const altura = (ini, fim) => Math.max(y(fim) - y(ini), 0)

/** Distribui reservas sobrepostas (lançadas manualmente) lado a lado. */
function distribuirEmFaixas(itens) {
  const fimDasFaixas = []
  for (const item of itens) {
    let faixa = fimDasFaixas.findIndex((fim) => fim <= item.ini)
    if (faixa === -1) {
      faixa = fimDasFaixas.length
      fimDasFaixas.push(0)
    }
    fimDasFaixas[faixa] = item.fim
    item.faixa = faixa
  }
  itens.forEach((item) => (item.totalFaixas = fimDasFaixas.length || 1))
  return itens
}

const colunas = computed(() =>
  props.espacos.map((espaco) => {
    const ocupados = distribuirEmFaixas(
      props.reservas
        .filter((r) => r.espaco === espaco.nome)
        .map((r) => ({ ...r, tipo: 'ocupado', ini: paraMinutos(r.horaInicio), fim: paraMinutos(r.horaFim) }))
        .sort((a, b) => a.ini - b.ini),
    )

    let inicioLivre = INICIO
    if (ehPassado.value) inicioLivre = FIM
    else if (ehHoje.value) inicioLivre = Math.max(INICIO, arredondarParaCima(agora.value, INTERVALO_MINUTOS))

    const livres = intervalosLivres(ocupados, inicioLivre, FIM)
      .filter((l) => l.fim - l.ini >= INTERVALO_MINUTOS)
      .map((l) => ({ ...l, tipo: 'livre' }))

    return {
      espaco,
      ocupados,
      livres,
      itens: [...ocupados, ...livres].sort((a, b) => a.ini - b.ini),
    }
  }),
)

function resumoColuna(coluna) {
  if (coluna.ocupados.length) {
    return `${coluna.ocupados.length} ${coluna.ocupados.length === 1 ? 'reserva' : 'reservas'}`
  }
  return ehPassado.value ? 'Sem reservas' : 'Livre o dia todo'
}

function reservar(espaco, intervalo) {
  emit('reservar', {
    espaco: espaco.nome,
    data: props.data,
    horaInicio: paraHora(intervalo.ini),
    horaFim: paraHora(Math.min(intervalo.ini + 60, intervalo.fim)),
  })
}
</script>

<template>
  <section class="space-y-4" aria-live="polite">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-terra-600">
          {{ ehHoje ? `Hoje · ${semana}` : semana }}
        </p>
        <h2 class="font-display text-2xl font-semibold text-tina-950 sm:text-3xl">{{ dataLonga }}</h2>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-600">
        <span v-if="carregando" class="inline-flex items-center gap-1.5 font-medium text-tina-700">
          <Icone nome="atualizar" class="h-3.5 w-3.5 animate-spin" /> Atualizando…
        </span>
        <span v-else-if="abaDisponivel && !erro" class="font-medium text-stone-700">
          {{ totalReservas }} {{ totalReservas === 1 ? 'reserva' : 'reservas' }} no dia
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="h-3 w-3 rounded border-l-4 border-tina-500 bg-tina-100"></span> Ocupado
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="h-3 w-3 rounded border border-dashed border-emerald-500 bg-emerald-50"></span> Livre
        </span>
      </div>
    </div>

    <!-- Erro de comunicação -->
    <div v-if="erro" class="cartao flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span class="grid h-12 w-12 place-items-center rounded-full bg-terra-100 text-terra-600">
        <Icone nome="alerta" class="h-6 w-6" />
      </span>
      <p class="max-w-md text-sm text-stone-600">{{ erro }}</p>
      <button type="button" class="btn-secundario" @click="emit('recarregar')">
        <Icone nome="atualizar" class="h-4 w-4" /> Tentar novamente
      </button>
    </div>

    <!-- Mês ainda sem aba na planilha -->
    <div v-else-if="!abaDisponivel" class="cartao flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span class="grid h-12 w-12 place-items-center rounded-full bg-tina-100 text-tina-700">
        <Icone nome="calendario" class="h-6 w-6" />
      </span>
      <p class="font-display text-lg font-semibold text-tina-950">Agenda ainda não aberta</p>
      <p class="max-w-md text-sm text-stone-600">
        {{ aviso || 'A agenda deste mês ainda não está disponível para reservas.' }}
      </p>
    </div>

    <div v-else :class="{ 'pointer-events-none opacity-60 transition-opacity': carregando }">
      <!-- Celular / tablet: um card por espaço -->
      <div class="grid gap-3 sm:grid-cols-2 lg:hidden">
        <article v-for="coluna in colunas" :key="coluna.espaco.nome" class="cartao p-4">
          <header class="flex items-center justify-between gap-2">
            <h3 class="flex items-center gap-2 font-semibold text-stone-900">
              <span class="h-2.5 w-2.5 rounded-full" :class="coluna.espaco.cor.ponto"></span>
              {{ coluna.espaco.nome }}
            </h3>
            <span
              class="rounded-full px-2.5 py-0.5 text-xs font-medium"
              :class="coluna.ocupados.length ? 'bg-stone-100 text-stone-600' : 'bg-emerald-50 text-emerald-700'"
            >
              {{ resumoColuna(coluna) }}
            </span>
          </header>

          <ul class="mt-3 space-y-2">
            <li v-for="item in coluna.itens" :key="`${item.tipo}-${item.ini}-${item.fim}-${item.atividade || ''}`">
              <div
                v-if="item.tipo === 'ocupado'"
                class="rounded-xl border-l-4 px-3 py-2.5"
                :class="coluna.espaco.cor.bloco"
              >
                <p class="flex items-center gap-1.5 text-xs font-semibold opacity-80">
                  <Icone nome="relogio" class="h-3.5 w-3.5" /> {{ item.horaInicio }} – {{ item.horaFim }}
                </p>
                <p class="mt-0.5 text-sm font-semibold leading-snug">{{ item.atividade || 'Reservado' }}</p>
                <p v-if="item.responsavel" class="mt-0.5 flex items-center gap-1 text-xs opacity-75">
                  <Icone nome="pessoa" class="h-3.5 w-3.5" /> {{ item.responsavel }}
                </p>
              </div>
              <button
                v-else
                type="button"
                class="group flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 px-3 py-2.5 text-left transition hover:border-emerald-500 hover:bg-emerald-50"
                @click="reservar(coluna.espaco, item)"
              >
                <span>
                  <span class="block text-xs font-semibold uppercase tracking-wide text-emerald-700">Livre</span>
                  <span class="text-sm text-stone-700">
                    {{ paraHora(item.ini) }} – {{ paraHora(item.fim) }}
                    <span class="text-stone-400">· {{ formatarDuracao(item.fim - item.ini) }}</span>
                  </span>
                </span>
                <span class="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-200 group-hover:bg-emerald-600 group-hover:text-white">
                  <Icone nome="mais" class="h-3.5 w-3.5" /> Reservar
                </span>
              </button>
            </li>
            <li v-if="!coluna.itens.length" class="rounded-xl bg-stone-50 px-3 py-3 text-sm text-stone-500">
              {{ ehPassado ? 'Nenhuma reserva neste dia.' : 'Sem horários livres hoje.' }}
            </li>
          </ul>
        </article>
      </div>

      <!-- Desktop: grade com os espaços lado a lado -->
      <div class="cartao hidden overflow-hidden lg:block">
        <div class="overflow-x-auto">
          <div
            class="grid"
            :style="{
              gridTemplateColumns: `4rem repeat(${colunas.length}, minmax(10.5rem, 1fr))`,
              minWidth: `${4 + colunas.length * 10.5}rem`,
            }"
          >
            <div class="sticky left-0 z-20 border-b border-stone-200 bg-white"></div>
            <div
              v-for="coluna in colunas"
              :key="`cab-${coluna.espaco.nome}`"
              class="border-b border-l border-stone-200 bg-white px-3 py-3"
            >
              <p class="flex items-center gap-2 text-sm font-semibold text-stone-900">
                <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="coluna.espaco.cor.ponto"></span>
                <span class="truncate">{{ coluna.espaco.nome }}</span>
              </p>
              <p class="mt-0.5 pl-[18px] text-xs text-stone-500">{{ resumoColuna(coluna) }}</p>
            </div>

            <div class="sticky left-0 z-10 bg-white" :style="{ height: `${alturaGrade}px` }">
              <div class="relative h-full">
                <span
                  v-for="h in horas"
                  :key="`h-${h}`"
                  class="absolute right-2 -translate-y-1/2 text-[11px] font-medium tabular-nums text-stone-400"
                  :style="{ top: `${y(h * 60)}px` }"
                >
                  {{ String(h).padStart(2, '0') }}h
                </span>
              </div>
            </div>

            <div
              v-for="(coluna, indice) in colunas"
              :key="`col-${coluna.espaco.nome}`"
              class="relative border-l border-stone-200"
              :style="{ height: `${alturaGrade}px` }"
            >
              <div
                v-for="h in horas"
                :key="`linha-${h}`"
                class="absolute inset-x-0 border-t border-stone-100"
                :style="{ top: `${y(h * 60)}px` }"
              ></div>

              <button
                v-for="livre in coluna.livres"
                :key="`livre-${livre.ini}`"
                type="button"
                class="group absolute inset-x-1.5 flex flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 text-xs text-emerald-700 transition hover:border-emerald-500 hover:bg-emerald-50"
                :style="{ top: `${y(livre.ini) + 2}px`, height: `${altura(livre.ini, livre.fim) - 4}px` }"
                :title="`Reservar ${coluna.espaco.nome} a partir de ${paraHora(livre.ini)}`"
                @click="reservar(coluna.espaco, livre)"
              >
                <span class="font-semibold">
                  <span class="group-hover:hidden group-focus-visible:hidden">Livre</span>
                  <span class="hidden group-hover:inline group-focus-visible:inline">+ Reservar</span>
                </span>
                <span v-if="altura(livre.ini, livre.fim) > 48" class="tabular-nums opacity-70">
                  {{ paraHora(livre.ini) }} – {{ paraHora(livre.fim) }}
                </span>
              </button>

              <div
                v-for="item in coluna.ocupados.filter((o) => altura(o.ini, o.fim) > 0)"
                :key="`oc-${item.ini}-${item.atividade}`"
                class="absolute overflow-hidden rounded-lg border-l-4 px-2.5 py-1.5 shadow-sm"
                :class="coluna.espaco.cor.bloco"
                :style="{
                  top: `${y(item.ini) + 2}px`,
                  height: `${altura(item.ini, item.fim) - 4}px`,
                  left: `calc(${(item.faixa / item.totalFaixas) * 100}% + 6px)`,
                  width: `calc(${100 / item.totalFaixas}% - 12px)`,
                }"
                :title="`${item.horaInicio} – ${item.horaFim} · ${item.atividade}${item.responsavel ? ` · ${item.responsavel}` : ''}`"
              >
                <p class="text-[11px] font-semibold tabular-nums opacity-80">{{ item.horaInicio }} – {{ item.horaFim }}</p>
                <p class="line-clamp-3 text-xs font-semibold leading-snug">{{ item.atividade || 'Reservado' }}</p>
                <p v-if="item.responsavel && altura(item.ini, item.fim) > 90" class="mt-0.5 truncate text-[11px] opacity-75">
                  {{ item.responsavel }}
                </p>
              </div>

              <div
                v-if="ehHoje && agora >= INICIO && agora <= FIM"
                class="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-terra-500"
                :style="{ top: `${y(agora)}px` }"
              >
                <span v-if="indice === 0" class="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-terra-500"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
