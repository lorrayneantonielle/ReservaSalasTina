import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// No GitHub Actions o nome do repositório vem de GITHUB_REPOSITORY ("usuario/repo").
// Localmente, ajuste o valor padrão se o seu repositório tiver outro nome.
const NOME_DO_REPOSITORIO = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'ReservaSalasTina'

export default defineConfig(({ command }) => ({
  plugins: [vue()],
  base:
    process.env.NODE_ENV === 'production' || command === 'build'
      ? `/${NOME_DO_REPOSITORIO}/`
      : '/',
}))
