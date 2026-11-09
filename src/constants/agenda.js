// Mantenha HORA_ABERTURA/HORA_FECHAMENTO iguais a CONFIG.HORA_MIN/HORA_MAX do Code.gs.
export const HORA_ABERTURA = '07:00'
export const HORA_FECHAMENTO = '23:00'
export const INTERVALO_MINUTOS = 30

// Os nomes precisam ser idênticos aos de ESPACOS no Code.gs.
// As classes ficam escritas por extenso para o Tailwind encontrá-las no build.
export const ESPACOS = [
  {
    nome: 'Sala de Atendimento',
    cor: {
      bloco: 'bg-violet-50 border-violet-500 text-violet-950',
      ponto: 'bg-violet-500',
    },
  },
  {
    nome: 'Sala Eliana Silva',
    cor: {
      bloco: 'bg-fuchsia-50 border-fuchsia-500 text-fuchsia-950',
      ponto: 'bg-fuchsia-500',
    },
  },
  {
    nome: 'Sala Valdete Guerra',
    cor: {
      bloco: 'bg-rose-50 border-rose-500 text-rose-950',
      ponto: 'bg-rose-500',
    },
  },
  {
    nome: 'Galpão',
    cor: {
      bloco: 'bg-amber-50 border-amber-500 text-amber-950',
      ponto: 'bg-amber-500',
    },
  },
  {
    nome: 'Cozinha',
    cor: {
      bloco: 'bg-emerald-50 border-emerald-500 text-emerald-950',
      ponto: 'bg-emerald-500',
    },
  },
  {
    nome: 'Garagem',
    cor: {
      bloco: 'bg-sky-50 border-sky-500 text-sky-950',
      ponto: 'bg-sky-500',
    },
  },
]
